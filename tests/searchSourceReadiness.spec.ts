import { describe, expect, it, vi } from 'vitest';
import type { SourceBean } from '../src/shared/types';
import { SearchSourceReadiness } from '../src/engine/vod/SearchSourceReadiness';

const source = (key: string): SourceBean => ({ key, name: key, type: 3 } as SourceBean);

describe('SearchSourceReadiness', () => {
  it('does not block ready sources on a runtime that is still preparing', async () => {
    const waitUntilReady = vi.fn(() => new Promise<void>(() => undefined));
    const inspect = vi.fn((entry: SourceBean) => entry.key === 'ready'
      ? { state: 'ready' as const }
      : { state: 'preparing' as const, reason: '正在转换', waitUntilReady });
    const runtimePort = {
      inspect,
    };
    const readiness = new SearchSourceReadiness(runtimePort, { i: vi.fn() });

    const result = await readiness.prepare({
      sources: [source('ready'), source('preparing')],
      unsupportedScopes: new Set<string>(),
    });

    expect(result.active).toEqual([0]);
    expect(result.skipped[1]).toMatchObject({
      key: 'preparing',
      status: 'error',
      error: '运行时就绪中：正在转换；本次未参与，完成后可重搜',
    });
    expect(waitUntilReady).not.toHaveBeenCalled();
    expect(inspect).toHaveBeenCalledTimes(2);
  });

  it('keeps unavailable and unsupported sources out of the active worker list', async () => {
    const readiness = new SearchSourceReadiness({
      inspect: () => ({ state: 'unavailable', reason: '缺少运行时' }),
    }, { i: vi.fn() });

    const result = await readiness.prepare({
      sources: [source('unsupported'), source('unavailable')],
      unsupportedScopes: new Set<string>(['unsupported']),
    });

    expect(result.active).toEqual([]);
    expect(result.skipped.map((entry) => entry?.error)).toEqual([
      '已跳过：该源在桌面端不支持（本会话已判定，单源搜索仍可单独尝试）',
      '缺少运行时',
    ]);
  });
});
