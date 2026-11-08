import { describe, expect, it, vi } from 'vitest';
import type { PlayerInitData, PlayerPagePlaybackWorkflowPort, PlayerPageWorkflowHistoryPort, PlayerSourceMemoryPort } from '../src/renderer/features/playback/application/playerPageSession';
import { createPlayerPageSessionWorkflow } from '../src/renderer/features/playback/application/playerPageSessionWorkflow';
import type { PlayerPageSessionAction } from '../src/renderer/features/playback/application/playerPageSessionState';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function playbackInit(): PlayerInitData {
  return {
    key: 'source-a',
    flag: 'line-a',
    episodes: [{ name: '第01集', url: 'episode-1' }, { name: '第02集', url: 'episode-2' }],
    epIndex: 1,
    title: '测试影片',
    lastUrl: '',
    lastName: '',
    startTime: 125,
    meta: { fromKey: 'source-a', id: 'movie-a', vodId: 'movie-a', profileId: 'profile-a', sourceName: 'Source A' },
  };
}

function alternateCandidate(): { id: string; sourceName: string; profileName: string; data: PlayerInitData } {
  return {
    id: 'profile-b\u001fsource-b\u001fmovie-b',
    sourceName: 'Source B',
    profileName: 'Profile B',
    data: {
      key: 'source-b',
      flag: 'line-b',
      episodes: [{ name: '第01集', url: 'other-episode-1' }, { name: '第02集', url: 'other-episode-2' }],
      epIndex: 1,
      title: '测试影片',
      lastUrl: '',
      lastName: '',
      startTime: 125,
      meta: { fromKey: 'source-b', id: 'movie-b', vodId: 'movie-b', profileId: 'profile-b', sourceName: 'Source B' },
    },
  };
}

describe('player page session workflow', () => {
  it('ignores hydration completion after disposal and cleans temporary playback files', async () => {
    const sourceLookup = deferred<{ profileId: string; name: string }>();
    const session: PlayerPagePlaybackWorkflowPort = {
      play: vi.fn(async () => ({ parse: 0, url: 'https://media.invalid/video.mp4', playUrl: '', flag: 'line-a' })),
      resolveHistorySource: vi.fn(() => sourceLookup.promise),
      loadDetail: vi.fn(async () => null),
      discover: vi.fn(async () => ({ candidates: [], incompleteSources: 0, truncated: false })),
      cleanupTemporaryFiles: vi.fn(async () => undefined),
    };
    const history: PlayerPageWorkflowHistoryPort = {
      beginPlayerHistorySession: vi.fn(),
      recordHistory: vi.fn(),
      persist: vi.fn(),
    };
    const sourceMemory: PlayerSourceMemoryPort = { rememberSource: vi.fn() };
    const actions: PlayerPageSessionAction[] = [];
    const workflow = createPlayerPageSessionWorkflow({ session, history, sourceMemory, publish: (action) => actions.push(action) });
    const init: PlayerInitData = {
      key: 'source-a',
      flag: 'line-a',
      episodes: [{ name: '第01集', url: 'episode-1' }],
      epIndex: 0,
      title: '测试影片',
      lastUrl: '',
      lastName: '',
    };

    const completion = workflow.applyInit(init);
    workflow.dispose();
    sourceLookup.resolve({ profileId: 'profile-a', name: 'Source A' });
    await completion;

    expect(actions).toEqual([
      { type: 'source-fallback-cleared' },
      { type: 'hydration-started' },
    ]);
    expect(session.play).not.toHaveBeenCalled();
    expect(history.recordHistory).not.toHaveBeenCalled();
    expect(session.cleanupTemporaryFiles).toHaveBeenCalledOnce();
  });

  it('automatically uses the only verified complete alternate and records history only after playback starts', async () => {
    const candidate = alternateCandidate();
    const session: PlayerPagePlaybackWorkflowPort = {
      play: vi.fn(async (input) => input.key === 'source-b'
        ? { parse: 0, url: 'https://media.invalid/alternate.mp4', playUrl: '', flag: input.flag }
        : { parse: 0, url: '', playUrl: '', flag: input.flag, message: '源站没有返回媒体流' }),
      resolveHistorySource: vi.fn(async () => ({ profileId: 'profile-a', name: 'Source A' })),
      loadDetail: vi.fn(async () => null),
      discover: vi.fn(async () => ({ candidates: [candidate], incompleteSources: 0, truncated: false })),
      cleanupTemporaryFiles: vi.fn(async () => undefined),
    };
    const history: PlayerPageWorkflowHistoryPort = {
      beginPlayerHistorySession: vi.fn(),
      recordHistory: vi.fn(),
      persist: vi.fn(),
    };
    const sourceMemory: PlayerSourceMemoryPort = { rememberSource: vi.fn() };
    const actions: PlayerPageSessionAction[] = [];
    const workflow = createPlayerPageSessionWorkflow({ session, history, sourceMemory, publish: action => actions.push(action) });

    await workflow.applyInit(playbackInit());
    await vi.waitFor(() => expect(session.play).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(actions).toContainEqual({ type: 'resolution-succeeded', url: 'https://media.invalid/alternate.mp4' }));

    expect(session.discover).toHaveBeenCalledWith(expect.objectContaining({ episodeIndex: 1, position: 125 }), expect.any(AbortSignal), expect.any(Function));
    expect(session.play).toHaveBeenNthCalledWith(2, expect.objectContaining({
      key: 'source-b',
      id: 'other-episode-2',
      parseOffset: undefined,
      fastRecovery: true,
    }));
    expect(history.recordHistory).not.toHaveBeenCalled();
    expect(sourceMemory.rememberSource).not.toHaveBeenCalled();

    workflow.confirmPlaybackStarted();

    expect(history.recordHistory).toHaveBeenCalledOnce();
    expect(history.recordHistory).toHaveBeenCalledWith(expect.objectContaining({ url: 'other-episode-2', time: 125, profileId: 'profile-b' }));
    expect(sourceMemory.rememberSource).toHaveBeenCalledWith(expect.objectContaining({ fromKey: 'source-b', id: 'movie-b' }));
  });

  it('cancels the still-running source scan after the verified alternate really starts', async () => {
    const first = alternateCandidate();
    const late = {
      ...first,
      id: 'profile-c\u001fsource-c\u001fmovie-c',
      sourceName: 'Source C',
      data: { ...first.data, key: 'source-c' },
    };
    const discovery = deferred<{ candidates: typeof first[]; incompleteSources: number; truncated: boolean }>();
    let discoverySignal: AbortSignal | undefined;
    const actions: PlayerPageSessionAction[] = [];
    const workflow = createPlayerPageSessionWorkflow({
      session: {
        play: vi.fn(async input => input.key === 'source-b'
          ? { parse: 0, url: 'https://media.invalid/alternate.mp4', playUrl: '', flag: input.flag }
          : { parse: 0, url: '', playUrl: '', flag: input.flag, message: '当前线路无媒体地址' }),
        resolveHistorySource: vi.fn(async () => ({ profileId: 'profile-a', name: 'Source A' })),
        loadDetail: vi.fn(async () => null),
        discover: vi.fn(async (_input, signal, onCandidate) => {
          discoverySignal = signal;
          onCandidate?.(first);
          return discovery.promise;
        }),
        cleanupTemporaryFiles: vi.fn(async () => undefined),
      },
      history: { beginPlayerHistorySession: vi.fn(), recordHistory: vi.fn(), persist: vi.fn() },
      sourceMemory: { rememberSource: vi.fn() },
      publish: action => actions.push(action),
    });

    const initializing = workflow.applyInit(playbackInit());
    await vi.waitFor(() => expect(actions).toContainEqual({
      type: 'resolution-succeeded', url: 'https://media.invalid/alternate.mp4', parseName: undefined,
    }));
    expect(discoverySignal?.aborted).toBe(false);

    workflow.confirmPlaybackStarted();
    expect(discoverySignal?.aborted).toBe(true);
    discovery.resolve({ candidates: [first, late], incompleteSources: 0, truncated: false });
    await initializing;

    expect(actions).not.toContainEqual(expect.objectContaining({
      type: 'source-fallback-candidate-found', candidate: expect.objectContaining({ id: late.id }),
    }));
  });

  it('searches verified sources immediately after a media failure without rotating parsers first', async () => {
    const candidate = alternateCandidate();
    const session: PlayerPagePlaybackWorkflowPort = {
      play: vi.fn(async (input) => ({
        parse: 0,
        url: input.key === 'source-b' ? 'https://media.invalid/alternate.mp4' : 'https://media.invalid/current.mp4',
        playUrl: '',
        flag: input.flag,
      })),
      resolveHistorySource: vi.fn(async () => ({ profileId: 'profile-a', name: 'Source A' })),
      loadDetail: vi.fn(async () => null),
      discover: vi.fn(async () => ({ candidates: [candidate], incompleteSources: 0, truncated: false })),
      cleanupTemporaryFiles: vi.fn(async () => undefined),
    };
    const history: PlayerPageWorkflowHistoryPort = {
      beginPlayerHistorySession: vi.fn(),
      recordHistory: vi.fn(),
      persist: vi.fn(),
    };
    const sourceMemory: PlayerSourceMemoryPort = { rememberSource: vi.fn() };
    const actions: PlayerPageSessionAction[] = [];
    const workflow = createPlayerPageSessionWorkflow({ session, history, sourceMemory, publish: action => actions.push(action) });

    await workflow.applyInit(playbackInit());
    expect(history.recordHistory).not.toHaveBeenCalled();

    await workflow.autoChangeParse(125, 'decode failed', 'media-failure');

    expect(session.play).toHaveBeenCalledTimes(2);
    expect(session.play).toHaveBeenNthCalledWith(2, expect.objectContaining({
      key: 'source-b',
      id: 'other-episode-2',
      parseOffset: undefined,
      fastRecovery: true,
    }));
    expect(session.discover).toHaveBeenCalledOnce();
    expect(history.recordHistory).not.toHaveBeenCalled();
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'source-fallback-switching',
      sourceName: 'Source B',
      candidateId: candidate.id,
    }));
    expect(actions).toContainEqual(expect.objectContaining({
      type: 'source-fallback-candidates-updated',
      candidates: [{ id: candidate.id, sourceName: candidate.sourceName, profileName: candidate.profileName }],
    }));

    workflow.confirmPlaybackStarted();

    expect(history.recordHistory).toHaveBeenCalledOnce();
  });

  it('lets the user force-refresh the backup-source search when the first scan is incomplete', async () => {
    const session: PlayerPagePlaybackWorkflowPort = {
      play: vi.fn(async () => ({ parse: 0, url: 'https://media.invalid/current.mp4', playUrl: '', flag: 'line-a' })),
      resolveHistorySource: vi.fn(async () => ({ profileId: 'profile-a', name: 'Source A' })),
      loadDetail: vi.fn(async () => null),
      discover: vi.fn(async () => ({ candidates: [], incompleteSources: 2, searchIncomplete: true, truncated: false })),
      cleanupTemporaryFiles: vi.fn(async () => undefined),
    };
    const history: PlayerPageWorkflowHistoryPort = {
      beginPlayerHistorySession: vi.fn(),
      recordHistory: vi.fn(),
      persist: vi.fn(),
    };
    const sourceMemory: PlayerSourceMemoryPort = { rememberSource: vi.fn() };
    const actions: PlayerPageSessionAction[] = [];
    const workflow = createPlayerPageSessionWorkflow({ session, history, sourceMemory, publish: action => actions.push(action) });

    await workflow.applyInit(playbackInit());
    await workflow.autoChangeParse(125, 'HTTP 403', 'media-failure');

    expect(actions).toContainEqual(expect.objectContaining({
      type: 'source-fallback-unavailable',
      message: expect.stringContaining('全源检查尚未完成。另有 2 个来源或影片详情未完成核验。'),
    }));
    await workflow.retryAlternativeSearch();

    expect(session.discover).toHaveBeenNthCalledWith(1, expect.objectContaining({ refresh: false, position: 125 }), expect.any(AbortSignal), expect.any(Function));
    expect(session.discover).toHaveBeenNthCalledWith(2, expect.objectContaining({ refresh: true, position: 125 }), expect.any(AbortSignal), expect.any(Function));
  });

  it('auto-switches to an exact verified candidate even when the aggregate search is incomplete', async () => {
    const candidate = alternateCandidate();
    const session: PlayerPagePlaybackWorkflowPort = {
      play: vi.fn(async (input) => input.key === 'source-b'
        ? { parse: 0, url: 'https://media.invalid/alternate.mp4', playUrl: '', flag: input.flag }
        : { parse: 0, url: '', playUrl: '', flag: input.flag, message: '源站没有返回媒体流' }),
      resolveHistorySource: vi.fn(async () => ({ profileId: 'profile-a', name: 'Source A' })),
      loadDetail: vi.fn(async () => null),
      discover: vi.fn(async () => ({ candidates: [candidate], incompleteSources: 1, truncated: false })),
      cleanupTemporaryFiles: vi.fn(async () => undefined),
    };
    const history: PlayerPageWorkflowHistoryPort = {
      beginPlayerHistorySession: vi.fn(),
      recordHistory: vi.fn(),
      persist: vi.fn(),
    };
    const sourceMemory: PlayerSourceMemoryPort = { rememberSource: vi.fn() };
    const actions: PlayerPageSessionAction[] = [];
    const workflow = createPlayerPageSessionWorkflow({ session, history, sourceMemory, publish: action => actions.push(action) });

    await workflow.applyInit(playbackInit());
    await vi.waitFor(() => expect(actions).toContainEqual(expect.objectContaining({ type: 'source-fallback-switching', sourceName: 'Source B' })));
    await vi.waitFor(() => expect(session.play).toHaveBeenCalledTimes(2));
    expect(history.recordHistory).not.toHaveBeenCalled();

    workflow.confirmPlaybackStarted();
    expect(history.recordHistory).toHaveBeenCalledOnce();
  });

  it('keeps discovering later candidates while the first verified source is resolving', async () => {
    const first = alternateCandidate();
    const second = {
      ...first,
      id: 'profile-c\u001fsource-c\u001fmovie-c',
      sourceName: 'Source C',
      data: {
        ...first.data,
        key: 'source-c',
        episodes: [{ name: '第01集', url: 'source-c-episode-1' }, { name: '第02集', url: 'source-c-episode-2' }],
        meta: { fromKey: 'source-c', id: 'movie-c', vodId: 'movie-c', profileId: 'profile-c', sourceName: 'Source C' },
      },
    };
    const discovery = deferred<{ candidates: typeof first[]; incompleteSources: number; truncated: boolean }>();
    const session: PlayerPagePlaybackWorkflowPort = {
      play: vi.fn(async (input) => input.key === 'source-a'
        ? { parse: 0, url: '', playUrl: '', flag: input.flag, message: '源站没有返回媒体流' }
        : { parse: 0, url: `https://media.invalid/${input.key}.mp4`, playUrl: '', flag: input.flag }),
      resolveHistorySource: vi.fn(async () => ({ profileId: 'profile-a', name: 'Source A' })),
      loadDetail: vi.fn(async () => null),
      discover: vi.fn(async (_input, _signal, onCandidate) => {
        onCandidate?.(first);
        return discovery.promise;
      }),
      cleanupTemporaryFiles: vi.fn(async () => undefined),
    };
    const history: PlayerPageWorkflowHistoryPort = {
      beginPlayerHistorySession: vi.fn(),
      recordHistory: vi.fn(),
      persist: vi.fn(),
    };
    const sourceMemory: PlayerSourceMemoryPort = { rememberSource: vi.fn() };
    const actions: PlayerPageSessionAction[] = [];
    const workflow = createPlayerPageSessionWorkflow({ session, history, sourceMemory, publish: action => actions.push(action) });

    await workflow.applyInit(playbackInit());
    await vi.waitFor(() => expect(actions).toContainEqual({ type: 'resolution-succeeded', url: 'https://media.invalid/source-b.mp4' }));
    const nextAfterFailure = workflow.autoChangeParse(92, 'segment failed', 'media-failure');
    discovery.resolve({ candidates: [first, second], incompleteSources: 0, truncated: false });
    await nextAfterFailure;

    expect(actions).toContainEqual(expect.objectContaining({ type: 'source-fallback-switching', sourceName: 'Source C' }));
    expect(actions).toContainEqual({ type: 'resolution-succeeded', url: 'https://media.invalid/source-c.mp4' });
    expect(session.play).toHaveBeenCalledWith(expect.objectContaining({ key: 'source-c', id: 'source-c-episode-2' }));
  });

  it('tries a queued verified source immediately while the discovery scan is still running', async () => {
    const first = alternateCandidate();
    const second = {
      ...first,
      id: 'profile-c\u001fsource-c\u001fmovie-c',
      sourceName: 'Source C',
      data: {
        ...first.data,
        key: 'source-c',
        episodes: [{ name: '第01集', url: 'source-c-episode-1' }, { name: '第02集', url: 'source-c-episode-2' }],
        meta: { fromKey: 'source-c', id: 'movie-c', vodId: 'movie-c', profileId: 'profile-c', sourceName: 'Source C' },
      },
    };
    const discovery = deferred<{ candidates: typeof first[]; incompleteSources: number; truncated: boolean }>();
    const session: PlayerPagePlaybackWorkflowPort = {
      play: vi.fn(async (input) => ({
        parse: 0,
        url: `https://media.invalid/${input.key}.mp4`,
        playUrl: '',
        flag: input.flag,
      })),
      resolveHistorySource: vi.fn(async () => ({ profileId: 'profile-a', name: 'Source A' })),
      loadDetail: vi.fn(async () => null),
      discover: vi.fn(async (_input, _signal, onCandidate) => {
        onCandidate?.(first);
        onCandidate?.(second);
        return discovery.promise;
      }),
      cleanupTemporaryFiles: vi.fn(async () => undefined),
    };
    const actions: PlayerPageSessionAction[] = [];
    const workflow = createPlayerPageSessionWorkflow({
      session,
      history: { beginPlayerHistorySession: vi.fn(), recordHistory: vi.fn(), persist: vi.fn() },
      sourceMemory: { rememberSource: vi.fn() },
      publish: action => actions.push(action),
    });

    await workflow.applyInit(playbackInit());
    const initialFailure = workflow.autoChangeParse(125, 'HTTP 403', 'media-failure');
    await vi.waitFor(() => expect(actions).toContainEqual({ type: 'resolution-succeeded', url: 'https://media.invalid/source-b.mp4' }));

    await workflow.autoChangeParse(92, 'segment failed', 'media-failure');

    expect(actions).toContainEqual(expect.objectContaining({ type: 'source-fallback-switching', sourceName: 'Source C' }));
    expect(actions).toContainEqual({ type: 'resolution-succeeded', url: 'https://media.invalid/source-c.mp4' });
    expect(session.play).toHaveBeenCalledWith(expect.objectContaining({ key: 'source-c', id: 'source-c-episode-2' }));

    discovery.resolve({ candidates: [first, second], incompleteSources: 0, truncated: false });
    await initialFailure;
  });

  it('keeps the classified media failure attached when no verified backup source is found', async () => {
    const session: PlayerPagePlaybackWorkflowPort = {
      play: vi.fn(async (input) => ({
        parse: 0,
        url: `https://media.invalid/${input.key}.mp4`,
        playUrl: '',
        flag: input.flag,
      })),
      resolveHistorySource: vi.fn(async () => ({ profileId: 'profile-a', name: 'Source A' })),
      loadDetail: vi.fn(async () => null),
      discover: vi.fn(async () => ({ candidates: [], incompleteSources: 0, truncated: false })),
      cleanupTemporaryFiles: vi.fn(async () => undefined),
    };
    const actions: PlayerPageSessionAction[] = [];
    const workflow = createPlayerPageSessionWorkflow({
      session,
      history: { beginPlayerHistorySession: vi.fn(), recordHistory: vi.fn(), persist: vi.fn() },
      sourceMemory: { rememberSource: vi.fn() },
      publish: action => actions.push(action),
    });

    await workflow.applyInit(playbackInit());
    await workflow.autoChangeParse(125, 'HTTP 403', 'media-failure', {
      stage: 'authorization', engine: 'html5', httpStatus: 403, retryable: false,
    });

    expect(actions).toContainEqual(expect.objectContaining({
      type: 'source-fallback-unavailable',
      message: expect.stringContaining('源站要求登录或拒绝了当前访问权限'),
    }));
  });

  it('keeps direct live playback out of VOD parsing, failover search and watch history', async () => {
    const session: PlayerPagePlaybackWorkflowPort = {
      play: vi.fn(async () => ({ parse: 0, url: '', playUrl: '', flag: '' })),
      resolveHistorySource: vi.fn(async () => ({ profileId: 'profile-a', name: 'Source A' })),
      loadDetail: vi.fn(async () => null),
      discover: vi.fn(async () => ({ candidates: [], incompleteSources: 0, truncated: false })),
      cleanupTemporaryFiles: vi.fn(async () => undefined),
    };
    const history: PlayerPageWorkflowHistoryPort = {
      beginPlayerHistorySession: vi.fn(),
      recordHistory: vi.fn(),
      persist: vi.fn(),
    };
    const sourceMemory: PlayerSourceMemoryPort = { rememberSource: vi.fn() };
    const actions: PlayerPageSessionAction[] = [];
    const workflow = createPlayerPageSessionWorkflow({ session, history, sourceMemory, publish: action => actions.push(action) });
    const directUrl = 'https://media.invalid/channel.m3u8';

    await workflow.applyInit({
      key: '',
      flag: '',
      episodes: [{ name: '新闻频道', url: directUrl }],
      epIndex: 0,
      title: '新闻频道',
      lastUrl: directUrl,
      lastName: '新闻频道',
      playbackKind: 'live',
      recordHistory: false,
    });

    expect(actions).toContainEqual({ type: 'resolution-succeeded', url: directUrl, parseName: undefined });
    expect(session.play).not.toHaveBeenCalled();
    expect(session.resolveHistorySource).not.toHaveBeenCalled();
    expect(await workflow.autoChangeParse(0, 'HTTP 403', 'media-failure')).toBe(false);
    workflow.retryCurrent('failed');
    workflow.confirmPlaybackStarted();

    expect(session.discover).not.toHaveBeenCalled();
    expect(session.play).not.toHaveBeenCalled();
    expect(history.recordHistory).not.toHaveBeenCalled();
    expect(history.persist).not.toHaveBeenCalled();
    expect(sourceMemory.rememberSource).not.toHaveBeenCalled();
  });

  it('prewarms the next VOD episode and reuses the bounded prepared result', async () => {
    const preparedResult = {
      parse: 0,
      url: 'http://127.0.0.1:9978/play?url=https%3A%2F%2Fmedia.invalid%2Fepisode-2.m3u8',
      playUrl: '',
      flag: 'line-a',
    };
    const session: PlayerPagePlaybackWorkflowPort = {
      play: vi.fn(async input => ({ parse: 0, url: `https://media.invalid/${input.id}.m3u8`, playUrl: '', flag: input.flag })),
      prewarm: vi.fn(async () => preparedResult),
      resolveHistorySource: vi.fn(async () => ({ profileId: 'profile-a', name: 'Source A' })),
      loadDetail: vi.fn(async () => null),
      discover: vi.fn(async () => ({ candidates: [], incompleteSources: 0, truncated: false })),
      cleanupTemporaryFiles: vi.fn(async () => undefined),
    };
    const actions: PlayerPageSessionAction[] = [];
    const workflow = createPlayerPageSessionWorkflow({
      session,
      history: { beginPlayerHistorySession: vi.fn(), recordHistory: vi.fn(), persist: vi.fn() },
      sourceMemory: { rememberSource: vi.fn() },
      publish: action => actions.push(action),
    });

    await workflow.applyInit({ ...playbackInit(), epIndex: 0, startTime: 0 });
    await vi.waitFor(() => expect(session.play).toHaveBeenCalledTimes(1));
    workflow.prepareNextEpisode();
    await vi.waitFor(() => expect(session.prewarm).toHaveBeenCalledTimes(1));
    expect(session.prewarm).toHaveBeenCalledWith({
      key: 'source-a', flag: 'line-a', id: 'episode-2', profileId: 'profile-a',
    }, expect.any(AbortSignal));

    workflow.selectEpisode(1);
    await vi.waitFor(() => expect(actions).toContainEqual(expect.objectContaining({
      type: 'resolution-succeeded', url: preparedResult.url,
    })));

    expect(session.play).toHaveBeenCalledTimes(1);
  });

  it('reports a failed prewarm and allows the same next episode to be retried', async () => {
    const preparedResult = {
      parse: 0,
      url: 'https://media.invalid/episode-2.m3u8',
      playUrl: '',
      flag: 'line-a',
    };
    const prewarm = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(preparedResult);
    const session: PlayerPagePlaybackWorkflowPort = {
      play: vi.fn(async input => ({ parse: 0, url: `https://media.invalid/${input.id}.m3u8`, playUrl: '', flag: input.flag })),
      prewarm,
      resolveHistorySource: vi.fn(async () => ({ profileId: 'profile-a', name: 'Source A' })),
      loadDetail: vi.fn(async () => null),
      discover: vi.fn(async () => ({ candidates: [], incompleteSources: 0, truncated: false })),
      cleanupTemporaryFiles: vi.fn(async () => undefined),
    };
    const actions: PlayerPageSessionAction[] = [];
    const workflow = createPlayerPageSessionWorkflow({
      session,
      history: { beginPlayerHistorySession: vi.fn(), recordHistory: vi.fn(), persist: vi.fn() },
      sourceMemory: { rememberSource: vi.fn() },
      publish: action => actions.push(action),
    });

    await workflow.applyInit({ ...playbackInit(), epIndex: 0, startTime: 0 });
    await vi.waitFor(() => expect(session.play).toHaveBeenCalledTimes(1));
    await expect(workflow.prepareNextEpisode()).resolves.toBe(false);
    await expect(workflow.prepareNextEpisode()).resolves.toBe(true);
    workflow.selectEpisode(1);

    await vi.waitFor(() => expect(actions).toContainEqual(expect.objectContaining({
      type: 'resolution-succeeded', url: preparedResult.url,
    })));
    expect(prewarm).toHaveBeenCalledTimes(2);
    expect(session.play).toHaveBeenCalledTimes(1);
  });

  it('aborts next-episode prewarming when the user switches episodes before it completes', async () => {
    const pendingPrewarm = deferred<import('../src/shared/types').PlayResult | null>();
    let prewarmSignal: AbortSignal | undefined;
    const session: PlayerPagePlaybackWorkflowPort = {
      play: vi.fn(async input => ({ parse: 0, url: `https://media.invalid/${input.id}.m3u8`, playUrl: '', flag: input.flag })),
      prewarm: vi.fn((_input, signal) => {
        prewarmSignal = signal;
        return pendingPrewarm.promise;
      }),
      resolveHistorySource: vi.fn(async () => ({ profileId: 'profile-a', name: 'Source A' })),
      loadDetail: vi.fn(async () => null),
      discover: vi.fn(async () => ({ candidates: [], incompleteSources: 0, truncated: false })),
      cleanupTemporaryFiles: vi.fn(async () => undefined),
    };
    const actions: PlayerPageSessionAction[] = [];
    const workflow = createPlayerPageSessionWorkflow({
      session,
      history: { beginPlayerHistorySession: vi.fn(), recordHistory: vi.fn(), persist: vi.fn() },
      sourceMemory: { rememberSource: vi.fn() },
      publish: action => actions.push(action),
    });

    await workflow.applyInit({ ...playbackInit(), epIndex: 0, startTime: 0 });
    await vi.waitFor(() => expect(session.play).toHaveBeenCalledTimes(1));
    workflow.prepareNextEpisode();
    await vi.waitFor(() => expect(session.prewarm).toHaveBeenCalledTimes(1));

    workflow.selectEpisode(1);
    expect(prewarmSignal?.aborted).toBe(true);
    await vi.waitFor(() => expect(session.play).toHaveBeenCalledTimes(2));
    pendingPrewarm.resolve({
      parse: 0, url: 'https://media.invalid/stale-prepared.m3u8', playUrl: '', flag: 'line-a',
    });
    await vi.waitFor(() => expect(actions).toContainEqual(expect.objectContaining({
      type: 'resolution-succeeded', url: 'https://media.invalid/episode-2.m3u8',
    })));

    expect(actions).not.toContainEqual(expect.objectContaining({
      type: 'resolution-succeeded', url: 'https://media.invalid/stale-prepared.m3u8',
    }));
  });
});
