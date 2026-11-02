export type LiveLatencyMode = 'stable' | 'low-latency';

/** Live buffer tuning is forbidden until both the caller and parsed playlist identify a live stream. */
export function shouldApplyLiveBufferConfig(input: { liveHint: boolean; playlistIsLive: boolean }): boolean {
  return input.liveHint && input.playlistIsLive;
}

/** A low-latency switch is meaningful only after the active live HLS playlist advertises parts. */
export function canSelectLowLatencyMode(input: { isLive: boolean | null; lowLatencySupported: boolean | null }): boolean {
  return input.isLive === true && input.lowLatencySupported === true;
}

export function effectiveLiveLatencyMode(input: {
  requestedMode: LiveLatencyMode;
  isCurrentStream: boolean;
  isLive: boolean | null;
  lowLatencySupported: boolean | null;
}): LiveLatencyMode {
  return input.requestedMode === 'low-latency' && input.isCurrentStream && canSelectLowLatencyMode(input)
    ? 'low-latency'
    : 'stable';
}

export interface LiveHlsLatencyConfig {
  liveSyncDurationCount: number;
  liveMaxLatencyDurationCount: number;
  maxLiveSyncPlaybackRate: number;
  maxBufferLength: number;
  maxMaxBufferLength: number;
  backBufferLength: number;
}

/**
 * HLS tuning is only applied to a live HLS session. VOD and catch-up streams
 * keep the player's normal buffer policy, regardless of the selected mode.
 */
export function liveHlsLatencyConfig(mode: LiveLatencyMode): LiveHlsLatencyConfig {
  if (mode === 'low-latency') {
    return {
      liveSyncDurationCount: 2,
      liveMaxLatencyDurationCount: 4,
      maxLiveSyncPlaybackRate: 1.05,
      maxBufferLength: 10,
      maxMaxBufferLength: 30,
      backBufferLength: 10,
    };
  }
  return {
    liveSyncDurationCount: 6,
    liveMaxLatencyDurationCount: 12,
    maxLiveSyncPlaybackRate: 1,
    maxBufferLength: 30,
    maxMaxBufferLength: 90,
    backBufferLength: 60,
  };
}

export interface LiveLatencyMeasurement {
  isLive: boolean;
  engine: 'hls.js' | 'native' | 'mpegts.js' | 'mpv' | 'unknown';
  currentTime: number;
  liveEdge?: number;
}

/** Return seconds behind the playlist edge only when both clocks are comparable. */
export function measureLiveEdgeLatency(input: LiveLatencyMeasurement): number | null {
  if (!input.isLive || input.engine !== 'hls.js') return null;
  if (!Number.isFinite(input.currentTime) || !Number.isFinite(input.liveEdge)) return null;
  return Math.max(0, input.liveEdge! - input.currentTime);
}

/** LL-HLS requires partial-segment metadata; ordinary HLS cannot promise sub-segment latency. */
export function supportsLowLatencyHls(input: { isLive: boolean; partTarget?: number | null }): boolean {
  return input.isLive && typeof input.partTarget === 'number' && Number.isFinite(input.partTarget) && input.partTarget > 0;
}
