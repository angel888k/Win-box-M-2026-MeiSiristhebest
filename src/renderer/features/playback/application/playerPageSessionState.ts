import type { PlayerInitData } from './playerPageSession';
import type { PlaybackFailureContext } from '../../../../shared/playbackFailure';

export interface PlayerSourceFallbackCandidate {
  id: string;
  sourceName: string;
  profileName: string;
}

interface PlayerSourceFallbackEvidence {
  candidates?: PlayerSourceFallbackCandidate[];
  incompleteSources?: number;
  searchIncomplete?: boolean;
  truncated?: boolean;
}

export type PlayerSourceFallbackState =
  | { kind: 'idle' }
  | ({ kind: 'searching' } & PlayerSourceFallbackEvidence)
  | ({ kind: 'switching'; sourceName: string; candidateId?: string; message?: string } & PlayerSourceFallbackEvidence)
  | ({ kind: 'unavailable'; message: string } & PlayerSourceFallbackEvidence);

export type PlayerPageResolutionState =
  | { kind: 'idle' }
  | { kind: 'hydrating' }
  | { kind: 'resolving' }
  | { kind: 'ready'; url: string; parseName?: string }
  | { kind: 'drive-bind-required'; provider: string }
  | { kind: 'failed'; message: string };

export interface PlayerPageSessionState {
  init: PlayerInitData | null;
  epIndex: number;
  curName: string;
  playName: string;
  resolution: PlayerPageResolutionState;
  sourceFallback: PlayerSourceFallbackState;
  playbackFailure?: PlaybackFailureContext;
}

export type PlayerPageSessionAction =
  | { type: 'hydration-started' }
  | { type: 'hydration-completed'; init: PlayerInitData; epIndex: number }
  | { type: 'hydration-failed'; message: string }
  | { type: 'init-updated'; init: PlayerInitData }
  | { type: 'resolution-started'; epIndex: number; curName: string; playName: string }
  | { type: 'resolution-succeeded'; url: string; parseName?: string }
  | { type: 'drive-bind-required'; provider: string }
  | { type: 'resolution-failed'; message: string }
  | { type: 'playback-failure-reported'; failure: PlaybackFailureContext }
  | { type: 'source-fallback-searching' }
  | { type: 'source-fallback-candidate-found'; candidate: PlayerSourceFallbackCandidate }
  | {
      type: 'source-fallback-candidates-updated';
      candidates: PlayerSourceFallbackCandidate[];
      incompleteSources: number;
      searchIncomplete: boolean;
      truncated: boolean;
    }
  | { type: 'source-fallback-switching'; sourceName: string; candidateId?: string; message?: string }
  | { type: 'source-fallback-unavailable'; message: string }
  | { type: 'source-fallback-cleared' }
  | { type: 'drive-bind-dismissed' };

export interface PlayerPageSessionPresentation {
  init: PlayerInitData | null;
  epIndex: number;
  activeUrl: string;
  curName: string;
  playName: string;
  resolving: boolean;
  driveBind: string | null;
  parseMsg: string;
  parseName?: string;
  sourceFallback: PlayerSourceFallbackState;
  playbackFailure?: PlaybackFailureContext;
}

export const initialPlayerPageSessionState: PlayerPageSessionState = {
  init: null,
  epIndex: 0,
  curName: '',
  playName: '',
  resolution: { kind: 'idle' },
  sourceFallback: { kind: 'idle' },
  playbackFailure: undefined,
};

export function reducePlayerPageSession(
  state: PlayerPageSessionState,
  action: PlayerPageSessionAction,
): PlayerPageSessionState {
  switch (action.type) {
    case 'hydration-started':
      return {
        ...state,
        init: null,
        epIndex: 0,
        curName: '',
        playName: '',
        resolution: { kind: 'hydrating' },
        sourceFallback: { kind: 'idle' },
        playbackFailure: undefined,
      };
    case 'hydration-completed':
      return {
        ...state,
        init: action.init,
        epIndex: action.epIndex,
        resolution: action.init.episodes.length === 0 ? { kind: 'idle' } : state.resolution,
      };
    case 'hydration-failed':
      return { ...state, resolution: { kind: 'failed', message: action.message } };
    case 'init-updated':
      return { ...state, init: action.init };
    case 'resolution-started':
      return {
        ...state,
        epIndex: action.epIndex,
        curName: action.curName,
        playName: action.playName,
        resolution: { kind: 'resolving' },
      };
    case 'resolution-succeeded':
      return { ...state, resolution: { kind: 'ready', url: action.url, parseName: action.parseName }, playbackFailure: undefined };
    case 'drive-bind-required':
      return { ...state, resolution: { kind: 'drive-bind-required', provider: action.provider } };
    case 'resolution-failed':
      return { ...state, resolution: { kind: 'failed', message: action.message } };
    case 'playback-failure-reported':
      return { ...state, playbackFailure: action.failure };
    case 'source-fallback-searching':
      return {
        ...state,
        sourceFallback: {
          kind: 'searching',
          candidates: [],
          incompleteSources: 0,
          searchIncomplete: false,
          truncated: false,
        },
      };
    case 'source-fallback-candidate-found': {
      const current = state.sourceFallback;
      if (current.kind === 'idle') return state;
      const candidates = current.candidates || [];
      return {
        ...state,
        sourceFallback: {
          ...current,
          candidates: candidates.some(candidate => candidate.id === action.candidate.id)
            ? candidates.map(candidate => candidate.id === action.candidate.id ? action.candidate : candidate)
            : [...candidates, action.candidate],
        },
      };
    }
    case 'source-fallback-candidates-updated': {
      const current = state.sourceFallback;
      if (current.kind === 'idle') return state;
      return {
        ...state,
        sourceFallback: {
          ...current,
          candidates: action.candidates,
          incompleteSources: action.incompleteSources,
          searchIncomplete: action.searchIncomplete,
          truncated: action.truncated,
        },
      };
    }
    case 'source-fallback-switching': {
      const current = state.sourceFallback;
      const evidence = current.kind === 'idle' ? {} : current;
      return {
        ...state,
        sourceFallback: {
          ...evidence,
          kind: 'switching',
          sourceName: action.sourceName,
          candidateId: action.candidateId,
          message: action.message,
        },
      };
    }
    case 'source-fallback-unavailable':
      return {
        ...state,
        sourceFallback: {
          ...(state.sourceFallback.kind === 'idle' ? {} : state.sourceFallback),
          kind: 'unavailable',
          message: action.message,
        },
      };
    case 'source-fallback-cleared':
      return { ...state, sourceFallback: { kind: 'idle' }, playbackFailure: undefined };
    case 'drive-bind-dismissed':
      return state.resolution.kind === 'drive-bind-required'
        ? { ...state, resolution: { kind: 'idle' } }
        : state;
  }
}

export function presentPlayerPageSession(state: PlayerPageSessionState): PlayerPageSessionPresentation {
  const resolution = state.resolution;
  return {
    init: state.init,
    epIndex: state.epIndex,
    activeUrl: resolution.kind === 'ready' ? resolution.url : '',
    curName: state.curName,
    playName: state.playName,
    resolving: resolution.kind === 'hydrating' || resolution.kind === 'resolving',
    driveBind: resolution.kind === 'drive-bind-required' ? resolution.provider : null,
    parseMsg: resolution.kind === 'failed' ? resolution.message : '',
    parseName: resolution.kind === 'ready' ? resolution.parseName : undefined,
    sourceFallback: state.sourceFallback,
    playbackFailure: state.playbackFailure,
  };
}
