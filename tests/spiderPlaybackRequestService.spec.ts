import { describe, expect, it, vi } from 'vitest';
import type { PlayResult, SourceBean } from '../src/shared/types';
import { SpiderPlaybackRequestService, type SpiderPlaybackRequestPorts } from '../src/main/spider/SpiderPlaybackRequestService';
import type { SourceExecutionContextValue } from '../src/main/spider/SourceExecutionContext';

const context: SourceExecutionContextValue = { profileId: 'profile-a', config: null };
const source = { key: 'source-a', name: 'Source A' } as SourceBean;
const playableResult = {
  parse: 0,
  url: 'https://media.example/video.m3u8',
  playUrl: '',
  flag: 'HD',
  jx: 0,
} as PlayResult;

function createService() {
  const dependencies: SpiderPlaybackRequestPorts = {
    execution: {
      forProfile: vi.fn((_profileId?: string) => context),
      forSource: vi.fn((_context, key) => key === source.key ? source : null),
    },
    playback: {
      execute: vi.fn(async () => playableResult),
      prewarm: vi.fn(async () => playableResult),
    },
    startTimer: vi.fn(() => ({ ms: () => 17 })),
    episodeFingerprint: vi.fn(() => 'episode-hash'),
    safeUrlSummary: vi.fn(() => 'media.example/video.m3u8'),
    directPlayUrlError: vi.fn(() => ''),
    recordDiagnostic: vi.fn(),
  };
  return { service: new SpiderPlaybackRequestService(dependencies), dependencies };
}

describe('SpiderPlaybackRequestService', () => {
  it('resolves the requested profile and source, then records a successful playback result', async () => {
    const { service, dependencies } = createService();

    await expect(service.execute(source.key, 'HD', 'private-episode-id', context.profileId)).resolves.toBe(playableResult);

    expect(dependencies.execution.forProfile).toHaveBeenCalledWith(context.profileId);
    expect(dependencies.execution.forSource).toHaveBeenCalledWith(context, source.key);
    expect(dependencies.playback.execute).toHaveBeenCalledWith(source.key, 'HD', 'private-episode-id', context, source);
    expect(dependencies.recordDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'play', stage: 'done', ok: true, ms: 17, key: source.key, flag: 'HD', ep: 'episode-hash',
      url: 'media.example/video.m3u8',
    }));
  });

  it('converts an invalid direct URL into a playback result the renderer can explain', async () => {
    const { service, dependencies } = createService();
    dependencies.playback.execute = vi.fn(async () => ({ ...playableResult, url: 'episode-id', playUrl: 'episode-id' }));
    dependencies.directPlayUrlError = vi.fn(() => '源站没有返回可播放地址');

    const result = await service.execute(source.key, 'HD', 'episode-id');

    expect(result).toMatchObject({ parse: 1, url: '', playUrl: '', message: '源站没有返回可播放地址' });
    expect(dependencies.recordDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'play', stage: 'done', ok: false, parse: 1, msg: '源站没有返回可播放地址',
    }));
  });

  it('forwards fast recovery mode and parser offset to the playback use case', async () => {
    const { service, dependencies } = createService();

    await service.execute(source.key, 'HD', 'episode-id', context.profileId, 2, true);

    expect(dependencies.playback.execute).toHaveBeenCalledWith(source.key, 'HD', 'episode-id', context, source, 2, true);
  });

  it('prewarms only direct remote media and preserves required request headers', async () => {
    const { service, dependencies } = createService();
    const controller = new AbortController();
    const directResult = {
      ...playableResult,
      header: { Referer: 'https://source.example/watch' },
    };
    dependencies.playback.prewarm = vi.fn(async () => directResult);

    const result = await service.prewarm(source.key, 'HD', 'episode-id', context.profileId, controller.signal);

    expect(dependencies.playback.prewarm).toHaveBeenCalledWith(source, 'HD', 'episode-id', [], expect.any(AbortSignal));
    const requestSignal = vi.mocked(dependencies.playback.prewarm).mock.calls[0]?.[4];
    expect(requestSignal?.aborted).toBe(false);
    controller.abort();
    expect(requestSignal?.aborted).toBe(true);
    expect(result?.url).toContain('127.0.0.1:9978/play?');
    expect(result?.url).toContain(encodeURIComponent(directResult.url));
    expect(result?.url).toContain(encodeURIComponent('https://source.example/watch'));
    expect(dependencies.recordDiagnostic).not.toHaveBeenCalled();
  });

  it('does not prewarm parser results, proxied URLs or failed results', async () => {
    const { service, dependencies } = createService();
    dependencies.playback.prewarm = vi.fn()
      .mockResolvedValueOnce({ ...playableResult, jx: 1 })
      .mockResolvedValueOnce({ ...playableResult, url: 'http://media.example/proxy?id=1' })
      .mockResolvedValueOnce({ ...playableResult, parse: 1 });

    await expect(service.prewarm(source.key, 'HD', 'episode-1')).resolves.toBeNull();
    await expect(service.prewarm(source.key, 'HD', 'episode-2')).resolves.toBeNull();
    await expect(service.prewarm(source.key, 'HD', 'episode-3')).resolves.toBeNull();
  });

  it('honors cancellation before and after resolving the source player content', async () => {
    const { service, dependencies } = createService();
    const controller = new AbortController();
    controller.abort(new Error('cancelled'));
    await expect(service.prewarm(source.key, 'HD', 'episode-id', context.profileId, controller.signal))
      .rejects.toThrow('cancelled');
    expect(dependencies.playback.prewarm).not.toHaveBeenCalled();
  });

  it('rethrows the original playback error even if diagnostic storage fails', async () => {
    const { service, dependencies } = createService();
    const playbackError = new Error('playerContent timeout');
    dependencies.playback.execute = vi.fn(async () => { throw playbackError; });
    dependencies.recordDiagnostic = vi.fn(() => { throw new Error('diagnostic disk unavailable'); });

    await expect(service.execute(source.key, 'HD', 'private-episode-id')).rejects.toBe(playbackError);
    expect(dependencies.recordDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'play', stage: 'failed', ok: false, reason: 'playerContent timeout',
    }));
  });
});
