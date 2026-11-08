/** Playback context controls which actions make sense in the standalone window. */
export type PlayerPlaybackKind = 'vod' | 'live' | 'live-catchup' | 'storage';

/** Serializable handoff payload shared by the main process and renderer. */
export interface PlayerInitData {
  key: string;
  flag: string;
  episodes: { name: string; url: string }[];
  epIndex: number;
  title: string;
  subtitleTitle?: string;
  lastUrl: string;
  lastName: string;
  meta?: {
    pic?: string;
    remarks?: string;
    sourceName?: string;
    vodId?: string;
    fromKey?: string;
    id?: string;
    profileId?: string;
  };
  startTime?: number;
  initSeq?: number;
  /** Do not create watch history for live and storage handoffs. Defaults to true. */
  recordHistory?: boolean;
  /** Internal session state: record only after the media engine confirms playback. */
  deferHistoryUntilPlayback?: boolean;
  /** Use shorter startup checks while automatically probing a verified backup source. */
  fastRecovery?: boolean;
  /** Preserve live/storage behavior when the same resource is opened in a separate window. */
  playbackKind?: PlayerPlaybackKind;
}
