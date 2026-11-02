import { describe, expect, it } from 'vitest';
import {
  observePlayerReadiness,
  projectPlayerCapabilitySummary,
  resolveSuperResolutionState,
} from '../src/renderer/features/playback/application/playerCapabilitySummary';

describe('player capability summary', () => {
  it('reports readiness only from observed HTML media data or MPV file-loaded state', () => {
    expect(observePlayerReadiness({ kernel: 'html5', htmlReadyState: 1 })).toBe(false);
    expect(observePlayerReadiness({ kernel: 'html5', htmlReadyState: 2 })).toBe(true);
    expect(observePlayerReadiness({ kernel: 'mpv', mpvLoaded: true })).toBe(true);
    expect(observePlayerReadiness({ kernel: 'mpv', mpvLoaded: false })).toBe(false);
    expect(observePlayerReadiness({ kernel: 'engine:plugin-a', htmlReadyState: 4 })).toBeUndefined();
    expect(observePlayerReadiness({ kernel: 'mpv' })).toBeUndefined();
  });

  it('does not infer support or readiness from the engine label', () => {
    const summary = projectPlayerCapabilitySummary({
      engineLabel: 'MPV',
      superResolution: 'unknown',
      audioTrackCount: null,
      subtitleTrackCount: null,
      resolution: null,
    });

    expect(summary.readiness).toBe('unknown');
    expect(summary.rows.every(row => row.state === 'unknown')).toBe(true);
  });

  it('reports explicit plugin capabilities separately from this media track observations', () => {
    const summary = projectPlayerCapabilitySummary({
      engineLabel: '示例内核',
      engineReady: true,
      declaredCapabilities: ['seek', 'rate', 'tracks'],
      superResolution: 'active',
      audioTrackCount: 2,
      subtitleTrackCount: 1,
      resolution: '1920 × 1080',
    });

    expect(summary.readiness).toBe('ready');
    expect(summary.rows.find(row => row.id === 'seek')).toMatchObject({ state: 'available' });
    expect(summary.rows.find(row => row.id === 'subtitle')).toMatchObject({ state: 'unavailable' });
    expect(summary.rows.find(row => row.id === 'tracks')).toMatchObject({
      state: 'available',
      detail: '本次播放已观察到 2 条音轨；1 条内嵌字幕',
    });
    expect(summary.rows.find(row => row.id === 'super-resolution')).toMatchObject({ statusLabel: '已观察到运行' });
    expect(summary.rows.find(row => row.id === 'super-resolution')?.detail).toContain('本次渲染管线');
    expect(summary.rows.find(row => row.id === 'resolution')).toMatchObject({ state: 'available', detail: '1920 × 1080' });
  });

  it('keeps an unverified render path unknown even when basic capabilities are declared', () => {
    const summary = projectPlayerCapabilitySummary({
      engineLabel: '插件播放器',
      declaredCapabilities: ['seek', 'rate'],
      superResolution: 'unknown',
      audioTrackCount: null,
      subtitleTrackCount: null,
      resolution: null,
    });

    expect(summary.rows.find(row => row.id === 'super-resolution')).toMatchObject({ state: 'unknown' });
    expect(summary.rows.find(row => row.id === 'fit')).toMatchObject({ state: 'unavailable' });
  });

  it('keeps source-dependent HTML track support unknown and reports observed dimensions', () => {
    const summary = projectPlayerCapabilitySummary({
      engineLabel: '标准播放',
      declaredCapabilities: ['seek', 'rate', 'subtitle', 'fit'],
      capabilityOverrides: { tracks: 'unknown' },
      superResolution: 'unavailable',
      audioTrackCount: 1,
      subtitleTrackCount: null,
      resolution: '1280 × 720',
    });

    expect(summary.rows.find(row => row.id === 'tracks')).toMatchObject({
      state: 'unknown',
      statusLabel: '本次已枚举',
      detail: '本次播放已观察到 1 条音轨；内嵌字幕数未报告',
    });
    expect(summary.rows.find(row => row.id === 'resolution')).toMatchObject({ state: 'available' });
  });

  it('only calls super resolution active after the matching render pipeline is observed', () => {
    expect(resolveSuperResolutionState({ kernel: 'mpv', pluginAvailable: true })).toBe('available');
    expect(resolveSuperResolutionState({ kernel: 'mpv', pluginAvailable: true, renderState: 'observed' })).toBe('active');
    expect(resolveSuperResolutionState({ kernel: 'mpv', pluginAvailable: true, renderState: 'not-observed' })).toBe('unavailable');
    expect(resolveSuperResolutionState({ kernel: 'html5', pluginAvailable: true, renderState: 'observed' })).toBe('unavailable');
  });
});
