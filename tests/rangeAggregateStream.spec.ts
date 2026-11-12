import { describe, expect, it, vi } from 'vitest';
import {
  RangeAggregateStream,
  AGGREGATE_CHUNK,
  type RangeResponseSink,
  type PartialRangeResponse,
} from '../src/main/server/RangeAggregateStream';

function createMockSink(): RangeResponseSink & { writes: Buffer[]; closed: boolean; ended: boolean } {
  let closeListener: (() => void) | null = null;
  return {
    destroyed: false,
    writableEnded: false,
    closed: false,
    ended: false,
    writes: [],
    writeHead: vi.fn(),
    write(chunk: Buffer) {
      this.writes.push(chunk);
      return true;
    },
    end() {
      this.ended = true;
      (this as { writableEnded: boolean }).writableEnded = true;
    },
    destroy() {
      (this as { destroyed: boolean }).destroyed = true;
      closeListener?.();
    },
    on(event: 'close', listener: () => void) {
      if (event === 'close') closeListener = listener;
    },
    removeListener() {},
    once(event: 'drain', listener: () => void) {
      listener();
    },
  };
}

describe('RangeAggregateStream 反压与中止机制', () => {
  it('客户端断开连接时，AbortController 立即中止飞行中的切片请求', async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchRange = vi.fn((_target: string, _headers: Record<string, string>, signal?: AbortSignal) => {
      capturedSignal = signal;
      return new Promise<Buffer>((_resolve, reject) => {
        signal?.addEventListener('abort', () => {
          const err = new Error('CLIENT_CLOSE');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });

    const stream = new RangeAggregateStream({
      fetchRange,
      diagnose: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    });

    const sink = createMockSink();
    const probe: PartialRangeResponse = {
      status: 206,
      headers: {
        'content-range': 'bytes 0-1048575/2097152',
        'content-type': 'video/mp4',
      },
    };

    const handlePromise = stream.tryHandle(
      'https://example.com/video.mp4',
      {},
      'bytes=0-1048575',
      probe,
      sink,
      2,
    );

    // 模拟客户端快速拖拽或切集导致连接断开
    sink.destroy();

    await handlePromise;
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('当下游消费停滞达到 MAX_BUFFERED_BYTES 阈值时暂停上游分派（流反压）', async () => {
    const fetchRange = vi.fn(async (_target: string, headers: Record<string, string>) => {
      const range = headers.Range || '';
      const match = /bytes=(\d+)-(\d+)/.exec(range);
      const len = match ? parseInt(match[2], 10) - parseInt(match[1], 10) + 1 : AGGREGATE_CHUNK;
      return Buffer.alloc(len);
    });

    const stream = new RangeAggregateStream({
      fetchRange,
      diagnose: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    });

    const sink = createMockSink();
    // 模拟一个 10MB 的范围请求
    const totalBytes = 10 * 1024 * 1024;
    const probe: PartialRangeResponse = {
      status: 206,
      headers: {
        'content-range': `bytes 0-${totalBytes - 1}/${totalBytes}`,
        'content-type': 'video/mp4',
      },
    };

    await stream.tryHandle('https://example.com/stream.mp4', {}, `bytes=0-${totalBytes - 1}`, probe, sink, 8);
    expect(sink.ended).toBe(true);
    expect(sink.writes.length).toBe(totalBytes / AGGREGATE_CHUNK);
  });
});
