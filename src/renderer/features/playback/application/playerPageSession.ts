import type { PlayResult, VodDetail } from '../../../../shared/types';
import type { PlayerHistoryProgressPort } from './playerHistoryProgress';
import type { PlaybackAlternativeCandidate, PlaybackAlternativeSearchResult } from './discoverPlaybackAlternatives';
import type { PlayerInitData } from '../../../../shared/playerInit';

export type { PlayerInitData } from '../../../../shared/playerInit';

export type PlaybackRecoveryCause = 'media-failure' | 'resolution-failure';

export interface PlaybackAlternativeDiscoveryPort {
  discover(input: {
    current: PlayerInitData;
    episodeIndex: number;
    position: number;
    excludedSourceIds: ReadonlySet<string>;
    refresh?: boolean;
  }, signal: AbortSignal, onCandidate?: (candidate: PlaybackAlternativeCandidate) => void): Promise<PlaybackAlternativeSearchResult>;
}

/** Capability required when resolving a selected episode to a playable URL. */
export interface PlayerPlaybackResolutionPort {
  play(input: { key: string; flag: string; id: string; profileId?: string; parseOffset?: number; fastRecovery?: boolean }): Promise<PlayResult>;
  prewarm?(input: { key: string; flag: string; id: string; profileId?: string }, signal: AbortSignal): Promise<PlayResult | null>;
}

/** Capabilities required when restoring source identity and an episode list from history. */
export interface PlayerInitHydrationPort {
  resolveHistorySource(input: { profileId?: string; sourceKey: string; sourceName?: string }): Promise<{ profileId: string; name: string }>;
  loadDetail(input: { key: string; ids: string[]; profileId?: string }): Promise<VodDetail | null>;
}

/** Events and readiness owned by the standalone player window. */
export interface PlayerPageEventsPort {
  onInit(listener: (data: PlayerInitData) => void): () => void;
  onEpisodeSwitch(listener: (index: number) => void): () => void;
  ready(): Promise<void>;
}

export interface PlayerTemporaryFileCleanupPort {
  cleanupTemporaryFiles(): Promise<void>;
}

/** Runtime capabilities needed by the player-page application workflow, without window event subscriptions. */
export interface PlayerPagePlaybackWorkflowPort extends
  PlayerPlaybackResolutionPort,
  PlayerInitHydrationPort,
  PlayerTemporaryFileCleanupPort,
  PlaybackAlternativeDiscoveryPort {}

/** Full capability bundle retained only by the player-session composition controller. */
export interface PlayerPageSessionPort extends PlayerPagePlaybackWorkflowPort, PlayerPageEventsPort {}

export interface PlayerPageHistoryPort extends PlayerHistoryProgressPort {
  beginPlayerHistorySession(): void;
}

/** History mutations needed by the player session, excluding progress reads owned by the playback adapter. */
export type PlayerPageWorkflowHistoryPort = Pick<PlayerPageHistoryPort, 'beginPlayerHistorySession' | 'recordHistory' | 'persist'>;

export interface PlayerSourceMemoryPort {
  rememberSource(source: { fromKey: string; id: string; name: string }): void;
}

export interface PlayerPageWindowPort {
  readAppIcon(): Promise<string>;
  readMaximized(): Promise<boolean>;
  readAlwaysOnTop(): Promise<boolean>;
  setAlwaysOnTop(enabled: boolean): Promise<boolean>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<boolean>;
  setMini(enabled: boolean): Promise<void>;
  close(): Promise<void>;
  onMiniChanged(listener: (enabled: boolean) => void): () => void;
}
