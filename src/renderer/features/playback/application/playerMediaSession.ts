export type PlayerMediaSessionAction =
  | 'play'
  | 'pause'
  | 'seekbackward'
  | 'seekforward'
  | 'seekto'
  | 'previoustrack'
  | 'nexttrack';

export interface PlayerMediaSessionMetadata {
  title: string;
  artist?: string;
  album?: string;
}

export interface PlayerMediaSessionActionDetails {
  seekTime?: number;
  seekOffset?: number;
}

export type PlayerMediaSessionActionHandler = (details?: PlayerMediaSessionActionDetails) => void;
export type PlayerMediaSessionPlaybackState = 'playing' | 'paused' | 'none' | 'unknown';

/** Narrow port around browser/Electron Media Session APIs. */
export interface PlayerMediaSessionPort {
  setMetadata(metadata: PlayerMediaSessionMetadata | null): void;
  setActionHandler(action: PlayerMediaSessionAction, handler: PlayerMediaSessionActionHandler | null): void;
  /** Unknown is a deliberate absence of evidence; adapters must not map it to playing. */
  setPlaybackState(state: PlayerMediaSessionPlaybackState): void;
}

export interface PlayerMediaSessionActions {
  play(): void;
  pause(): void;
  seekBy(seconds: number): void;
  seekTo(seconds: number): void;
  previous?(): void;
  next?(): void;
}

/** Project a real HTML media element snapshot; readyState 0 means there is no playback receipt yet. */
export function readPlayerMediaSessionPlaybackState(input: {
  readyState: number;
  paused: boolean;
  ended: boolean;
  hasError: boolean;
}): PlayerMediaSessionPlaybackState {
  if (input.hasError || input.ended) return 'none';
  // HTMLMediaElement.HAVE_NOTHING is 0. Metadata or a later state is a real session receipt.
  if (!Number.isFinite(input.readyState) || input.readyState < 1) return 'unknown';
  return input.paused ? 'paused' : 'playing';
}

/** MPV state comes from its file-loaded/status events, never from the selected kernel name alone. */
export function readMpvMediaSessionPlaybackState(input: {
  readiness: 'ready' | 'not-ready' | 'unknown';
  loading: boolean;
  paused: boolean;
  hasError: boolean;
}): PlayerMediaSessionPlaybackState {
  if (input.hasError) return 'none';
  if (input.loading || input.readiness !== 'ready') return 'unknown';
  return input.paused ? 'paused' : 'playing';
}

/** Connect only the actions this player can fulfill; unsupported OS actions are isolated by the adapter. */
export function attachPlayerMediaSession(
  port: PlayerMediaSessionPort,
  metadata: PlayerMediaSessionMetadata,
  actions: PlayerMediaSessionActions,
  options: { canSeek: boolean; canPrevious: boolean; canNext: boolean },
): () => void {
  try { port.setMetadata(metadata); } catch { /* Metadata is optional and must not disrupt playback. */ }
  const registered: PlayerMediaSessionAction[] = [];
  const register = (action: PlayerMediaSessionAction, handler: PlayerMediaSessionActionHandler) => {
    try {
      port.setActionHandler(action, handler);
      registered.push(action);
    } catch {
      // Browsers and embedded Chromium builds expose different action subsets.
    }
  };

  register('play', () => actions.play());
  register('pause', () => actions.pause());
  if (options.canSeek) {
    register('seekbackward', details => actions.seekBy(-seekOffset(details?.seekOffset)));
    register('seekforward', details => actions.seekBy(seekOffset(details?.seekOffset)));
    register('seekto', details => {
      if (typeof details?.seekTime === 'number' && Number.isFinite(details.seekTime) && details.seekTime >= 0) {
        actions.seekTo(details.seekTime);
      }
    });
  }
  if (options.canPrevious && actions.previous) register('previoustrack', () => actions.previous?.());
  if (options.canNext && actions.next) register('nexttrack', () => actions.next?.());

  return () => {
    for (const action of registered) {
      try { port.setActionHandler(action, null); } catch { /* Cleanup must not block playback teardown. */ }
    }
    try { port.setPlaybackState('none'); } catch { /* Playback state is an optional platform surface. */ }
    try { port.setMetadata(null); } catch { /* Metadata is an optional platform surface. */ }
  };
}

function seekOffset(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 10;
}
