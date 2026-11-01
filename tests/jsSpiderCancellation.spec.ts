import { describe, expect, it, vi } from 'vitest';
import { JsSpider } from '../src/engine/js/JsSpider';
import type { JsSpiderRuntimePort } from '../src/engine/js/JsSandboxPort';
import type { EngineHost } from '../src/engine/ports';
import { NullLogger } from '../src/engine/util/logger';

describe('JsSpider cancellation', () => {
  it('forwards detail cancellation to the JS runtime invocation', async () => {
    const controller = new AbortController();
    let finishCall!: (value: unknown) => void;
    const callMethod = vi.fn((_names: string[], _args: unknown[], _timeoutMs: number, signal?: AbortSignal) => {
      expect(signal).toBe(controller.signal);
      return new Promise<unknown>((resolve) => { finishCall = resolve; });
    });
    const runtime: JsSpiderRuntimePort = {
      siteKey: 'js',
      spiderStyle: 'unknown',
      setExt: vi.fn(),
      ensureLoaded: vi.fn(async () => undefined),
      callMethod,
      destroy: vi.fn(),
    };
    const host = {
      http: { request: vi.fn() },
      kv: {},
      logger: NullLogger,
      jsSandboxFactory: vi.fn(() => runtime),
    } as unknown as EngineHost;
    const spider = new JsSpider({ key: 'js', api: 'https://example.com/source.js', ext: '', jar: '', host });

    const detail = spider.detailContent(['movie-1'], controller.signal);
    await vi.waitFor(() => expect(callMethod).toHaveBeenCalledTimes(1));
    controller.abort(new Error('detail closed'));

    await expect(detail).rejects.toMatchObject({ name: 'AbortError', message: 'detail closed' });
    finishCall({ list: [] });
  });
});
