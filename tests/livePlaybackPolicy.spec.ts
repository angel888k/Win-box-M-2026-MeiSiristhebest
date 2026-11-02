import { describe, expect, it } from 'vitest';
import {
  canSelectLowLatencyMode,
  effectiveLiveLatencyMode,
  liveHlsLatencyConfig,
  measureLiveEdgeLatency,
  shouldApplyLiveBufferConfig,
  supportsLowLatencyHls,
} from '../src/renderer/features/playback/application/livePlaybackPolicy';

describe('live playback policy', () => {
  it('keeps a larger buffer in stable mode and a bounded smaller buffer in low-latency mode', () => {
    const stable = liveHlsLatencyConfig('stable');
    const lowLatency = liveHlsLatencyConfig('low-latency');
    expect(stable.liveSyncDurationCount).toBeGreaterThan(lowLatency.liveSyncDurationCount);
    expect(stable.maxBufferLength).toBeGreaterThan(lowLatency.maxBufferLength);
    expect(lowLatency.maxLiveSyncPlaybackRate).toBeGreaterThan(1);
    expect(lowLatency.maxLiveSyncPlaybackRate).toBeLessThanOrEqual(1.05);
  });

  it('measures edge distance only for a live hls.js timeline with finite comparable times', () => {
    expect(measureLiveEdgeLatency({ isLive: true, engine: 'hls.js', currentTime: 95, liveEdge: 101 })).toBe(6);
    expect(measureLiveEdgeLatency({ isLive: true, engine: 'hls.js', currentTime: 105, liveEdge: 101 })).toBe(0);
    expect(measureLiveEdgeLatency({ isLive: false, engine: 'hls.js', currentTime: 5, liveEdge: 10 })).toBeNull();
    expect(measureLiveEdgeLatency({ isLive: true, engine: 'mpv', currentTime: 5, liveEdge: 10 })).toBeNull();
    expect(measureLiveEdgeLatency({ isLive: true, engine: 'hls.js', currentTime: Number.NaN, liveEdge: 10 })).toBeNull();
  });

  it('requires an explicit partial-segment target before claiming LL-HLS support', () => {
    expect(supportsLowLatencyHls({ isLive: true, partTarget: 0.5 })).toBe(true);
    expect(supportsLowLatencyHls({ isLive: true, partTarget: 0 })).toBe(false);
    expect(supportsLowLatencyHls({ isLive: false, partTarget: 0.5 })).toBe(false);
    expect(supportsLowLatencyHls({ isLive: true })).toBe(false);
  });
  it('applies live tuning only when both the page and playlist identify live playback', () => {
    expect(shouldApplyLiveBufferConfig({ liveHint: true, playlistIsLive: true })).toBe(true);
    expect(shouldApplyLiveBufferConfig({ liveHint: true, playlistIsLive: false })).toBe(false);
    expect(shouldApplyLiveBufferConfig({ liveHint: false, playlistIsLive: true })).toBe(false);
  });

  it('offers low-latency mode only after the active stream proves live LL-HLS support', () => {
    expect(canSelectLowLatencyMode({ isLive: true, lowLatencySupported: true })).toBe(true);
    expect(canSelectLowLatencyMode({ isLive: true, lowLatencySupported: false })).toBe(false);
    expect(canSelectLowLatencyMode({ isLive: null, lowLatencySupported: true })).toBe(false);
    expect(canSelectLowLatencyMode({ isLive: false, lowLatencySupported: true })).toBe(false);
  });

  it('forces stable mode for another channel, VOD, or an unverified protocol', () => {
    const lowMode = { requestedMode: 'low-latency' as const, isLive: true, lowLatencySupported: true };
    expect(effectiveLiveLatencyMode({ ...lowMode, isCurrentStream: true })).toBe('low-latency');
    expect(effectiveLiveLatencyMode({ ...lowMode, isCurrentStream: false })).toBe('stable');
    expect(effectiveLiveLatencyMode({ ...lowMode, isCurrentStream: true, isLive: false })).toBe('stable');
    expect(effectiveLiveLatencyMode({ ...lowMode, isCurrentStream: true, lowLatencySupported: null })).toBe('stable');
  });

});
