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
      '播放内核无法解码媒体数据，正在查找已核验的同集备用来源…',
      'auto-change',
      'page-failure',
    ]);
    expect(autoChangeParse).toHaveBeenCalledWith(42, 'decode failed', 'media-failure', expect.objectContaining({ stage: 'decode', engine: 'unknown' }));
    expect(onPlaybackFailure).toHaveBeenCalledWith(42, 'decode failed', expect.objectContaining({ stage: 'decode', engine: 'unknown' }));
  });

  it('passes sanitized failure context into recovery and uses it in the player message', async () => {
    const notify = vi.fn();
    const autoChangeParse = vi.fn(() => Promise.resolve(true));
    const failure = { stage: 'authorization' as const, engine: 'hls.js' as const, httpStatus: 403, retryable: false };

    await reportPlaybackFailure(42, 'HTTP 403', { autoChangeParse, notify }, failure);

    expect(autoChangeParse).toHaveBeenCalledWith(42, 'HTTP 403', 'media-failure', failure);
    expect(notify).toHaveBeenCalledWith('源站要求登录或拒绝了当前访问权限，正在查找已核验的同集备用来源…');
  });

  it('reports rejected failover without leaving an unhandled rejection', async () => {
    const notify = vi.fn();
    const onPlaybackFailure = vi.fn();

    await expect(reportPlaybackFailure(12, 'network error', {
      autoChangeParse: () => Promise.reject(new Error('no more parses')),
      onPlaybackFailure,
      notify,
    })).resolves.toBeUndefined();

    expect(onPlaybackFailure).toHaveBeenCalledWith(12, 'network error', expect.objectContaining({ stage: 'network', retryable: true }));
    expect(notify).toHaveBeenLastCalledWith('备用来源检索失败：no more parses');
  });

  it('explains when the automatic parse-switch budget is exhausted', async () => {
    const notify = vi.fn();
    await reportPlaybackFailure(12, 'network error', {
      autoChangeParse: () => Promise.resolve(false),
      notify,
    });

    expect(notify).toHaveBeenNthCalledWith(1, '网络请求未能稳定取得媒体数据，正在查找已核验的同集备用来源…');
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

    expect(onPlaybackFailure).toHaveBeenCalledWith(0, 'engine exited', expect.objectContaining({ stage: 'unknown' }));
    expect(notify).toHaveBeenLastCalledWith('备用来源检索失败：session unavailable');
  });

  it('reports delegated playback failures when automatic parse switching is absent', async () => {
    const notify = vi.fn();
    const onPlaybackFailure = vi.fn();

    await reportPlaybackFailure(8, 'stream ended', { onPlaybackFailure, notify });

    expect(onPlaybackFailure).toHaveBeenCalledWith(8, 'stream ended', expect.objectContaining({ stage: 'unknown' }));
    expect(notify).not.toHaveBeenCalled();
  });

  it('uses a safe classified summary when no structured failure was supplied', async () => {
    const notify = vi.fn();
    await reportPlaybackFailure(8, 'HTTP 403 https://media.invalid/watch?token=secret', {
      autoChangeParse: vi.fn(() => Promise.resolve(true)),
      notify,
    });

    expect(notify).toHaveBeenCalledWith('源站要求登录或拒绝了当前访问权限，正在查找已核验的同集备用来源…');
    expect(JSON.stringify(notify.mock.calls)).not.toContain('secret');
  });
});
