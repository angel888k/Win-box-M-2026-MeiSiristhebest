// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type {
  PlayerInitData,
  PlayerPagePlaybackWorkflowPort,
  PlayerPageWorkflowHistoryPort,
  PlayerSourceMemoryPort,
} from '../src/renderer/features/playback/application/playerPageSession';
import { createPlayerPageSessionWorkflow } from '../src/renderer/features/playback/application/playerPageSessionWorkflow';
import type { PlayerPageSessionAction } from '../src/renderer/features/playback/application/playerPageSessionState';

describe('autoChangeParse flag failover (同片多线路秒级自动换线)', () => {
  it('automatically switches to the next available flag in the same video without running full search', async () => {
    const playCalls: Array<{ flag: string; id: string }> = [];
    const session: PlayerPagePlaybackWorkflowPort = {
      play: vi.fn(async (input) => {
        playCalls.push({ flag: input.flag, id: input.id });
        if (input.flag === 'line-1') {
          return { parse: 0, url: 'https://media.invalid/line-1.m3u8', playUrl: '', flag: 'line-1' };
        }
        if (input.flag === 'line-2') {
          return { parse: 0, url: 'https://media.invalid/line-2.m3u8', playUrl: '', flag: 'line-2' };
        }
        return { parse: 0, url: '', playUrl: '', flag: input.flag, message: '无流' };
      }),
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
    const workflow = createPlayerPageSessionWorkflow({
      session,
      history,
      sourceMemory,
      publish: (action) => actions.push(action),
    });

    const initData: PlayerInitData = {
      key: 'source-a',
      flag: 'line-1',
      episodes: [
        { name: '第01集', url: 'ep-line1-1' },
        { name: '第02集', url: 'ep-line1-2' },
      ],
      epIndex: 1,
      title: '流浪地球2',
      lastUrl: '',
      lastName: '流浪地球2 - 第02集',
      startTime: 30,
      meta: {
        fromKey: 'source-a',
        id: 'movie-100',
        vodId: 'movie-100',
        profileId: 'profile-a',
        sourceName: '优质片源网',
        flags: ['line-1', 'line-2', 'line-3'],
        allEpisodes: {
          'line-1': [
            { name: '第01集', url: 'ep-line1-1' },
            { name: '第02集', url: 'ep-line1-2' },
          ],
          'line-2': [
            { name: '第01集', url: 'ep-line2-1' },
            { name: '第02集', url: 'ep-line2-2' },
          ],
          'line-3': [
            { name: '第01集', url: 'ep-line3-1' },
            { name: '第02集', url: 'ep-line3-2' },
          ],
        },
      },
    };

    // 1. 起播初始片源 (line-1, 第02集)
    await workflow.applyInit(initData);
    await vi.waitFor(() => expect(playCalls).toEqual([{ flag: 'line-1', id: 'ep-line1-2' }]));

    // 2. 模拟播放器发生 403 / 解码中断 / 掉线，触发 autoChangeParse
    const switched = await workflow.autoChangeParse(120, '403 Forbidden', 'media-failure');
    expect(switched).toBe(true);

    // 3. 验证秒级切至 line-2 同一集 (第02集 ep-line2-2)，并保留断点进度 120 秒
    expect(playCalls).toEqual([
      { flag: 'line-1', id: 'ep-line1-2' },
      { flag: 'line-2', id: 'ep-line2-2' },
    ]);

    // 4. 验证产生 HUD 切换通知
    const switchAction = actions.find(
      (a) => a.type === 'source-fallback-switching' && a.sourceName?.includes('line-2'),
    );
    expect(switchAction).toBeDefined();

    // 5. 验证根本无需调用昂贵的全网跨源大爬虫搜索 (session.discover 未被调用)
    expect(session.discover).not.toHaveBeenCalled();
  });

  it('falls back to cross-site discovery when all lines in current video are exhausted', async () => {
    const session: PlayerPagePlaybackWorkflowPort = {
      play: vi.fn(async (input) => {
        if (input.key === 'other-source') {
          return { parse: 0, url: 'https://media.invalid/backup.mp4', playUrl: '', flag: input.flag };
        }
        return { parse: 1, url: '', playUrl: '', flag: input.flag, message: '解析不可用' };
      }),
      resolveHistorySource: vi.fn(async () => ({ profileId: 'profile-a', name: 'Source A' })),
      loadDetail: vi.fn(async () => null),
      discover: vi.fn(async () => ({
        candidates: [
          {
            id: 'other-candidate',
            sourceName: '备用源B',
            profileName: 'Profile B',
            data: {
              key: 'other-source',
              flag: 'default',
              episodes: [{ name: '第01集', url: 'other-ep-1' }],
              epIndex: 0,
              title: '流浪地球2',
              lastUrl: 'other-ep-1',
              lastName: '流浪地球2 - 第01集',
              meta: { profileId: 'profile-b' },
            },
          },
        ],
        incompleteSources: 0,
        truncated: false,
      })),
      cleanupTemporaryFiles: vi.fn(async () => undefined),
    };

    const workflow = createPlayerPageSessionWorkflow({
      session,
      history: { beginPlayerHistorySession: vi.fn(), recordHistory: vi.fn(), persist: vi.fn() },
      sourceMemory: { rememberSource: vi.fn() },
      publish: vi.fn(),
    });

    const initData: PlayerInitData = {
      key: 'source-a',
      flag: 'line-1',
      episodes: [{ name: '第01集', url: 'ep-1' }],
      epIndex: 0,
      title: '流浪地球2',
      lastUrl: 'ep-1',
      lastName: '流浪地球2 - 第01集',
      meta: {
        vodId: 'movie-100',
        flags: ['line-1', 'line-2'],
        allEpisodes: {
          'line-1': [{ name: '第01集', url: 'ep-1' }],
          'line-2': [{ name: '第01集', url: 'ep-2' }],
        },
      },
    };

    // 1. 初始化
    await workflow.applyInit(initData);
    // 2. 线路 1 失败后触发换源 -> 自动切线路 2，线路 2 也失败
    await workflow.autoChangeParse(10, '解码失败', 'media-failure');

    // 3. 此时全部线路耗尽，顺利触发跨站备用源搜索 (session.discover 被调用)
    expect(session.discover).toHaveBeenCalled();
  });
});
