import { describe, expect, it, vi } from 'vitest';
import type { AggVodItem, SearchAllReport, VodDetail } from '../src/shared/types';
import { discoverPlaybackAlternatives, sourceIdentity } from '../src/renderer/features/playback/application/discoverPlaybackAlternatives';
import type { PlayerInitData } from '../src/renderer/features/playback/application/playerPageSession';

const current: PlayerInitData = {
  key: 'current-source',
  flag: 'line-a',
  episodes: [{ name: '第01集', url: 'current-episode-1' }, { name: '第02集', url: 'current-episode-2' }],
  epIndex: 1,
  title: '海风',
  lastUrl: '',
  lastName: '',
  meta: { profileId: 'profile-current', fromKey: 'current-source', id: 'current-id', vodId: 'current-id' },
};

function searchItem(overrides: Partial<AggVodItem> = {}): AggVodItem {
  return {
    id: 'alternate-id',
    name: '海风',
    pic: 'https://images.invalid/poster.jpg',
    remarks: '更新至12集',
    year: '2024',
    area: '中国大陆',
    type: '剧情',
    sourceKey: 'alternate-source',
    sourceRef: { profileId: 'profile-alternate', key: 'alternate-source' },
    sourceName: '备用源',
    sourceProfileName: '备用档案',
    ...overrides,
  };
}

function detail(overrides: Partial<VodDetail> = {}): VodDetail {
  return {
    id: 'alternate-id',
    name: '海风',
    pic: '',
    type: '剧情',
    year: '2024',
    area: '中国大陆',
    director: '',
    actor: '',
    des: '',
    remarks: '',
    flags: ['线路B'],
    episodes: { 线路B: [{ name: '第02集', url: 'alternate-episode-2' }] },
    ...overrides,
  };
}

function report(items: AggVodItem[], overrides: Partial<SearchAllReport> = {}): SearchAllReport {
  return {
    items,
    perSource: [],
    hitSources: items.length,
    failedSources: 0,
    totalRaw: items.length,
    ...overrides,
  };
}

function makePort(items: AggVodItem[], candidateDetail: VodDetail, searchReport = report(items)) {
  return {
    search: vi.fn(async () => searchReport),
    loadDetail: vi.fn(async ({ id }: { id: string }) => id === 'current-id' ? detail({ id: 'current-id' }) : candidateDetail),
  };
}

describe('discoverPlaybackAlternatives', () => {
  it('returns only an exact-title, exact-year, explicitly matching episode and preserves position', async () => {
    const port = makePort([searchItem()], detail());
    const result = await discoverPlaybackAlternatives({
      current,
      episodeIndex: 1,
      position: 137,
      excludedSourceIds: new Set([sourceIdentity('profile-current', 'current-source', 'current-id')]),
    }, port, new AbortController().signal);

    expect(port.search).toHaveBeenCalledWith('海风', expect.any(AbortSignal), expect.any(Function), false);
    expect(result).toMatchObject({ incompleteSources: 0, truncated: false, candidates: [{ sourceName: '备用源' }] });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].data).toMatchObject({
      key: 'alternate-source',
      flag: '线路B',
      epIndex: 0,
      startTime: 137,
      deferHistoryUntilPlayback: true,
      meta: { profileId: 'profile-alternate', vodId: 'alternate-id' },
    });
  });

  it('rejects related titles, year conflicts, and ambiguous episode matches', async () => {
    const related = searchItem({ id: 'related', name: '海风演员访谈' });
    const wrongYear = searchItem({ id: 'wrong-year', year: '2023' });
    const ambiguous = searchItem({ id: 'ambiguous' });
    const port = makePort([related, wrongYear, ambiguous], detail({
      id: 'ambiguous',
      episodes: {
        线路B: [{ name: 'S01E02', url: 'episode-a' }, { name: 'S01E02', url: 'episode-b' }],
      },
    }));

    const result = await discoverPlaybackAlternatives({ current, episodeIndex: 1, position: 0, excludedSourceIds: new Set() }, port, new AbortController().signal);

    expect(result.candidates).toEqual([]);
    expect(port.loadDetail).toHaveBeenCalledTimes(2); // Current item plus the one exact-title candidate.
  });

  it('counts failed and pending sources as incomplete, preventing automatic selection', async () => {
    const port = makePort([searchItem()], detail(), report([searchItem()], { failedSources: 2, pendingSources: 3 }));

    const result = await discoverPlaybackAlternatives({ current, episodeIndex: 1, position: 0, excludedSourceIds: new Set() }, port, new AbortController().signal);

    expect(result.candidates).toHaveLength(1);
    expect(result.incompleteSources).toBe(5);
  });

  it('accepts an otherwise exact candidate when its source omits the year metadata', async () => {
    const item = searchItem({ year: undefined });
    const port = makePort([item], detail({ year: '' }));

    const result = await discoverPlaybackAlternatives({ current, episodeIndex: 1, position: 0, excludedSourceIds: new Set() }, port, new AbortController().signal);

    expect(result.candidates).toHaveLength(1);
    expect(result.incompleteSources).toBe(0);
  });

  it('verifies and publishes a candidate before aggregate search has completed', async () => {
    const item = searchItem();
    const candidateReady = vi.fn();
    let finishSearch!: (value: SearchAllReport) => void;
    const port = {
      search: vi.fn((_query: string, _signal: AbortSignal, onReport: (value: SearchAllReport) => void) => {
        onReport(report([item]));
        return new Promise<SearchAllReport>(resolve => { finishSearch = resolve; });
      }),
      loadDetail: vi.fn(async ({ id }: { id: string }) => id === 'current-id' ? detail({ id }) : detail()),
    };

    const pending = discoverPlaybackAlternatives({
      current,
      episodeIndex: 1,
      position: 137,
      excludedSourceIds: new Set(),
    }, port, new AbortController().signal, candidateReady);

    await vi.waitFor(() => expect(candidateReady).toHaveBeenCalledOnce());
    expect(candidateReady.mock.calls[0][0].sourceName).toBe('备用源');
    finishSearch(report([item]));
    await expect(pending).resolves.toMatchObject({ candidates: [{ sourceName: '备用源' }] });
  });

  it('aborts an in-flight detail request when discovery is canceled', async () => {
    const item = searchItem();
    const controller = new AbortController();
    let candidateDetailSignal: AbortSignal | undefined;
    const port = {
      search: vi.fn(async (_query: string, _signal: AbortSignal, onReport: (value: SearchAllReport) => void) => {
        const result = report([item]);
        onReport(result);
        return result;
      }),
      loadDetail: vi.fn(({ id }: { id: string }, signal?: AbortSignal) => {
        if (id === 'current-id') return Promise.resolve(detail({ id }));
        candidateDetailSignal = signal;
        return new Promise<VodDetail>((_resolve, reject) => {
          const rejectCanceled = () => reject(new Error('detail request canceled'));
          if (signal?.aborted) rejectCanceled();
          else signal?.addEventListener('abort', rejectCanceled, { once: true });
        });
      }),
    };

    const pending = discoverPlaybackAlternatives({
      current,
      episodeIndex: 1,
      position: 0,
      excludedSourceIds: new Set(),
    }, port, controller.signal);

    await vi.waitFor(() => expect(candidateDetailSignal).toBeDefined());
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(candidateDetailSignal?.aborted).toBe(true);
  });

  it('keeps exact candidates from a partial scan when the aggregate search deadline expires', async () => {
    vi.useFakeTimers();
    try {
      const item = searchItem();
      const port = {
        search: vi.fn((_query: string, _signal: AbortSignal, onReport: (value: SearchAllReport) => void) => {
          onReport(report([item], { pendingSources: 9 }));
          return new Promise<SearchAllReport>(() => undefined);
        }),
        loadDetail: vi.fn(async ({ id }: { id: string }) => id === 'current-id' ? detail({ id }) : detail()),
      };

      const pending = discoverPlaybackAlternatives({
        current,
        episodeIndex: 1,
        position: 33,
        excludedSourceIds: new Set(),
      }, port, new AbortController().signal);

      await vi.advanceTimersByTimeAsync(45_000);
      await expect(pending).resolves.toMatchObject({
        searchIncomplete: true,
        incompleteSources: 9,
        candidates: [{ sourceName: '备用源', data: { startTime: 33 } }],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds all batched detail verification to the shared discovery deadline', async () => {
    vi.useFakeTimers();
    try {
      const items = Array.from({ length: 24 }, (_, index) => searchItem({
        id: `slow-${index}`,
        sourceKey: `slow-source-${index}`,
        sourceRef: { profileId: `slow-profile-${index}`, key: `slow-source-${index}` },
      }));
      const port = {
        search: vi.fn(async (_query: string, _signal: AbortSignal, onReport: (value: SearchAllReport) => void) => {
          const result = report(items);
          onReport(result);
          return result;
        }),
        loadDetail: vi.fn(({ id }: { id: string }, detailSignal?: AbortSignal) => {
          if (id === 'current-id') return Promise.resolve(detail({ id }));
          return new Promise<VodDetail>((_resolve, reject) => {
            const rejectCanceled = () => reject(new Error('detail request canceled'));
            if (detailSignal?.aborted) rejectCanceled();
            else detailSignal?.addEventListener('abort', rejectCanceled, { once: true });
          });
        }),
      };

      const pending = discoverPlaybackAlternatives({
        current,
        episodeIndex: 1,
        position: 0,
        excludedSourceIds: new Set(),
      }, port, new AbortController().signal);

      await vi.advanceTimersByTimeAsync(60_000);
      await expect(pending).resolves.toMatchObject({ candidates: [], incompleteSources: 24, truncated: false });
      expect(port.loadDetail).toHaveBeenCalledTimes(25);
    } finally {
      vi.useRealTimers();
    }
  });

  it('verifies up to 24 exact source details with bounded concurrency and marks the result truncated beyond that budget', async () => {
    const items = Array.from({ length: 25 }, (_, index) => searchItem({
      id: `alternate-${index}`,
      sourceKey: `source-${index}`,
      sourceRef: { profileId: `profile-${index}`, key: `source-${index}` },
    }));
    let activeLookups = 0;
    let maxConcurrentLookups = 0;
    const port = {
      search: vi.fn(async () => report(items)),
      loadDetail: vi.fn(async ({ id }: { id: string }) => {
        if (id === 'current-id') return detail({ id: 'current-id' });
        activeLookups += 1;
        maxConcurrentLookups = Math.max(maxConcurrentLookups, activeLookups);
        await new Promise(resolve => setTimeout(resolve, 1));
        activeLookups -= 1;
        return detail({ id });
      }),
    };

    const result = await discoverPlaybackAlternatives({ current, episodeIndex: 1, position: 0, excludedSourceIds: new Set() }, port, new AbortController().signal);

    expect(result.candidates).toHaveLength(24);
    expect(result.truncated).toBe(true);
    expect(maxConcurrentLookups).toBe(4);
  });
});
