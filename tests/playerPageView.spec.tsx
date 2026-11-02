// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { PlayerPageSession } from '../src/renderer/features/playback/usePlayerPageSession';
import type { PlayerPageWindowState } from '../src/renderer/features/playback/usePlayerPageWindow';
import { PlayerPageView } from '../src/renderer/pages/PlayerPageView';

vi.mock('../src/renderer/components/VideoPlayer', () => ({
  default: ({ statusOverlay }: { statusOverlay?: ReactNode }) => (
    <div className="vplayer">{statusOverlay}</div>
  ),
}));

describe('PlayerPageView', () => {
  it('shows verified fallback sources inside the player and lets the user choose one', () => {
    const selectAlternative = vi.fn(() => true);
    const session: PlayerPageSession = {
      init: null,
      epIndex: 0,
      activeUrl: 'https://media.example/video.m3u8',
      curName: '',
      playName: '',
      resolving: false,
      driveBind: null,
      parseMsg: '',
      episodes: [],
      canPrev: false,
      canNext: false,
      selectEpisode: vi.fn(),
      prepareNextEpisode: vi.fn(),
      retryCurrent: vi.fn(),
      autoChangeParse: vi.fn(),
      retryAlternativeSearch: vi.fn(async () => true),
      selectAlternative,
      confirmPlaybackStarted: vi.fn(),
      sourceFallback: {
        kind: 'switching',
        sourceName: '王子小线 · 南风线路',
        candidateId: 'source-current',
        candidates: [
          { id: 'source-current', sourceName: '王子小线', profileName: '南风线路' },
          { id: 'source-next', sourceName: '分享者线', profileName: '主档案' },
        ],
        incompleteSources: 3,
        searchIncomplete: true,
        truncated: false,
      },
      dismissDriveBinding: vi.fn(),
      onDriveBound: vi.fn(),
    };
    const windowState: PlayerPageWindowState = {
      appIcon: '',
      maximized: false,
      mini: false,
      pinTop: false,
      minimize: vi.fn(),
      toggleMaximize: vi.fn(),
      setMini: vi.fn(),
      togglePinTop: vi.fn(),
      close: vi.fn(),
    };

    render(<PlayerPageView session={session} windowState={windowState} title="Win-Box" onResolutionChange={vi.fn()} />);

    expect(screen.getByText('正在尝试：王子小线 · 南风线路')).toBeTruthy();
    const recovery = document.querySelector('.player-recovery-overlay');
    expect(recovery?.getAttribute('data-recovery-state')).toBe('switching');
    expect(recovery?.closest('.vplayer')).toBeTruthy();
    expect(recovery?.closest('.pwin-stage')).toBeTruthy();
    expect(document.querySelector('.player-stage-notices')).toBeNull();
    expect(screen.getByRole('button', { name: '正在尝试播放 王子小线，南风线路' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '尝试播放 分享者线，主档案' }));
    expect(selectAlternative).toHaveBeenCalledWith('source-next');
    expect(screen.getByText(/另有 3 个来源或影片详情未能完成核验/)).toBeTruthy();
  });

  it('offers a retry action when initial hydration fails before an init is available', () => {
    const retryCurrent = vi.fn();
    const retryAlternativeSearch = vi.fn(async () => true);
    const session: PlayerPageSession = {
      init: null,
      epIndex: 0,
      activeUrl: '',
      curName: '',
      playName: '',
      resolving: false,
      driveBind: null,
      parseMsg: '档案读取失败',
      episodes: [],
      canPrev: false,
      canNext: false,
      selectEpisode: vi.fn(),
      prepareNextEpisode: vi.fn(),
      retryCurrent,
      autoChangeParse: vi.fn(),
      retryAlternativeSearch,
      selectAlternative: vi.fn(() => false),
      confirmPlaybackStarted: vi.fn(),
      sourceFallback: { kind: 'unavailable', message: '还没有找到备用来源' },
      dismissDriveBinding: vi.fn(),
      onDriveBound: vi.fn(),
    };
    const windowState: PlayerPageWindowState = {
      appIcon: '',
      maximized: false,
      mini: false,
      pinTop: false,
      minimize: vi.fn(),
      toggleMaximize: vi.fn(),
      setMini: vi.fn(),
      togglePinTop: vi.fn(),
      close: vi.fn(),
    };

    render(<PlayerPageView session={session} windowState={windowState} title="Win-Box" onResolutionChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '重试当前来源' }));
    expect(retryCurrent).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '重新搜索备用来源' }));
    expect(retryAlternativeSearch).toHaveBeenCalledOnce();
  });
});
