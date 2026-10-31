import { describe, expect, it, vi } from 'vitest';
import { reportPlaybackFailure } from '../src/renderer/features/playback/application/reportPlaybackFailure';

describe('reportPlaybackFailure', () => {
  it('starts parse failover and notifies the owning playback page synchronously', async () => {
    const order: string[] = [];
    const autoChangeParse = vi.fn(() => {
      order.push('auto-change');
      return Promise.resolve(true);
    });
    const onPlaybackFailure = vi.fn(() => order.push('page-failure'));
    const notify = vi.fn((message: string) => order.push(message));

    await reportPlaybackFailure(42, 'decode failed', { autoChangeParse, onPlaybackFailure, notify });

    expect(order).toEqual([
      '当前媒体流播放失败（decode failed），正在查找已核验的同集备用来源…',
      'auto-change',
      'page-failure',
    ]);
    expect(autoChangeParse).toHaveBeenCalledWith(42, 'decode failed', 'media-failure');
    expect(onPlaybackFailure).toHaveBeenCalledWith(42, 'decode failed');
  });

  it('reports rejected failover without leaving an unhandled rejection', async () => {
    const notify = vi.fn();
    const onPlaybackFailure = vi.fn();

    await expect(reportPlaybackFailure(12, 'network error', {
      autoChangeParse: () => Promise.reject(new Error('no more parses')),
      onPlaybackFailure,
      notify,
    })).resolves.toBeUndefined();

    expect(onPlaybackFailure).toHaveBeenCalledWith(12, 'network error');
    expect(notify).toHaveBeenLastCalledWith('备用来源检索失败：no more parses');
  });

  it('explains when the automatic parse-switch budget is exhausted', async () => {
    const notify = vi.fn();
    await reportPlaybackFailure(12, 'network error', {
      autoChangeParse: () => Promise.resolve(false),
      notify,
    });

    expect(notify).toHaveBeenNthCalledWith(1, '当前媒体流播放失败（network error），正在查找已核验的同集备用来源…');
    expect(notify).toHaveBeenLastCalledWith('暂未找到已核验的备用来源；可重新搜索，或切换到其他播放源。');
  });

  it('still reports playback failure when parse failover throws synchronously', async () => {
    const notify = vi.fn();
    const onPlaybackFailure = vi.fn();

    await reportPlaybackFailure(0, 'engine exited', {
      autoChangeParse: () => { throw new Error('session unavailable'); },
      onPlaybackFailure,
      notify,
    });

    expect(onPlaybackFailure).toHaveBeenCalledWith(0, 'engine exited');
    expect(notify).toHaveBeenLastCalledWith('备用来源检索失败：session unavailable');
  });

  it('reports delegated playback failures when automatic parse switching is absent', async () => {
    const notify = vi.fn();
    const onPlaybackFailure = vi.fn();

    await reportPlaybackFailure(8, 'stream ended', { onPlaybackFailure, notify });

    expect(onPlaybackFailure).toHaveBeenCalledWith(8, 'stream ended');
    expect(notify).not.toHaveBeenCalled();
  });
});
