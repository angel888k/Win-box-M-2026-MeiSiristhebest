// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectPlayerCapabilitySummary } from '../src/renderer/features/playback/application/playerCapabilitySummary';
import { PlayerCapabilitySummaryView } from '../src/renderer/features/playback/PlayerCapabilitySummaryView';

describe('PlayerCapabilitySummaryView', () => {
  afterEach(cleanup);

  it('announces observed readiness and separates current-session facts from declared support', () => {
    const summary = projectPlayerCapabilitySummary({
      engineLabel: 'MPV',
      engineReady: true,
      declaredCapabilities: ['seek', 'rate', 'tracks'],
      superResolution: 'unknown',
      audioTrackCount: 2,
      subtitleTrackCount: null,
      resolution: '1920 × 1080',
    });

    render(<PlayerCapabilitySummaryView summary={summary} onClose={() => undefined} />);

    expect(screen.getByRole('heading', { name: '当前播放器能力' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('MPV · 已就绪');
    expect(screen.getAllByText('已声明支持')).toHaveLength(2);
    expect(screen.getByText('本次播放已观察到 2 条音轨；内嵌字幕数未报告')).toBeTruthy();
    expect(screen.getByText('状态未知')).toBeTruthy();
  });

  it('shows unknown instead of claiming readiness when the active session has not reported it', () => {
    const summary = projectPlayerCapabilitySummary({
      engineLabel: '插件播放器',
      declaredCapabilities: ['seek'],
      superResolution: 'unknown',
      audioTrackCount: null,
      subtitleTrackCount: null,
      resolution: null,
    });
    const onClose = vi.fn();
    render(<PlayerCapabilitySummaryView summary={summary} onClose={onClose} />);

    expect(screen.getByRole('status').textContent).toBe('插件播放器 · 就绪状态未知');
    fireEvent.click(screen.getByRole('button', { name: '关闭能力面板' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
