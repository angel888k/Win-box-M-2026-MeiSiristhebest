import { buildSlices, parseByteRange } from './mediaTransforms';

export const AGGREGATE_CHUNK = 512 * 1024;
export const AGGREGATE_CONCURRENCY = 8;
export const AGGREGATE_MIN_LEN = 1 * 1024 * 1024;
export const AGGREGATE_MAX_BUFFERED_BYTES = 8 * 1024 * 1024; // 8MB 反压高水位限额

export interface RangeResponseSink {
  readonly destroyed: boolean;
  readonly writableEnded: boolean;
  writeHead(status: number, headers: Record<string, string>): unknown;
  write(chunk: Buffer): boolean;
  end(): void;
  destroy(): unknown;
  on(event: 'close', listener: () => void): unknown;
  removeListener(event: 'close', listener: () => void): unknown;
  once(event: 'drain', listener: () => void): unknown;
}

export interface PartialRangeResponse {
  status: number;
  headers: Record<string, unknown>;
}

export interface RangeAggregateDiagnostic {
  reason: string;
  url: string;
  total?: number;
}

export interface RangeAggregatePorts {
  fetchRange(target: string, headers: Record<string, string>, signal?: AbortSignal): Promise<Buffer>;
  diagnose(event: RangeAggregateDiagnostic): void;
  warn(message: string): void;
  error(message: string, cause: unknown): void;
}

/** Parse the total byte count from a single-range Content-Range response. */
export function partialRangeTotal(headers: Record<string, unknown>): number | null {
  const raw = headers['content-range'];
  if (raw === undefined || raw === null) return null;
  const value = Array.isArray(raw) ? raw[0] : String(raw);
  const match = /^bytes \d+-\d+\/(\d+)/.exec(value);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Bounded, ordered Range fan-out for media responses. Request transport, diagnostics,
 * and the HTTP response sink are supplied by adapters so the scheduling policy can
 * be exercised without coupling it to LocalProxyServer.
 */
export class RangeAggregateStream {
  constructor(private readonly ports: RangeAggregatePorts) {}

  async tryHandle(
    target: string,
    headers: Record<string, string>,
    rangeHeader: string,
    probe: PartialRangeResponse,
    response: RangeResponseSink,
    concurrency = AGGREGATE_CONCURRENCY,
  ): Promise<boolean> {
    const total = partialRangeTotal(probe.headers);
    if (total === null) {
      this.ports.diagnose({ reason: 'no-content-range', url: target });
      return false;
    }
    const parsed = parseByteRange(rangeHeader);
    if (!parsed) {
      this.ports.diagnose({ reason: `range-parse-fail:${rangeHeader}`, url: target });
      return false;
    }
    const start = parsed.start;
    const end = parsed.end === undefined ? total - 1 : Math.min(parsed.end, total - 1);
    const length = end - start + 1;
    if (length < AGGREGATE_MIN_LEN) {
      this.ports.diagnose({ reason: `range-too-small:${length}<${AGGREGATE_MIN_LEN}`, total, url: target });
      return false;
    }

    const contentType = (probe.headers['content-type'] as string | undefined) || 'application/octet-stream';
    response.writeHead(206, {
      'Content-Type': contentType,
      'Content-Length': String(length),
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
    });

    const slices = buildSlices(start, end, AGGREGATE_CHUNK);
    const abortController = new AbortController();
    const aborted = { flag: false };
    const onClientClose = (): void => {
      aborted.flag = true;
      abortController.abort();
    };
    response.on('close', onClientClose);
    try {
      await this.aggregatePipelined(slices, target, headers, response, aborted, abortController, concurrency);
    } catch (error) {
      if (!(error instanceof Error) || error.name !== 'AbortError') this.ports.error('proxy /play 聚合流错误', error);
    } finally {
      response.removeListener('close', onClientClose);
    }
    return true;
  }

  private async aggregatePipelined(
    slices: Array<{ start: number; end: number }>,
    target: string,
    headers: Record<string, string>,
    response: RangeResponseSink,
    aborted: { flag: boolean },
    abortController: AbortController,
    concurrency: number,
  ): Promise<void> {
    const ready = new Map<number, Buffer>();
    let bufferedBytes = 0;
    let nextWrite = 0;
    let dispatched = 0;
    let draining = false;
    let finished = false;
    let resolveDone: () => void;
    const donePromise = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    abortController.signal.addEventListener('abort', () => resolveDone?.(), { once: true });

    const maybeFinish = (): void => {
      if (!finished && nextWrite === slices.length && !response.writableEnded) {
        finished = true;
        response.end();
        resolveDone?.();
      }
    };

    const dispatch = (): void => {
      while (
        !aborted.flag &&
        !abortController.signal.aborted &&
        dispatched < slices.length &&
        dispatched - nextWrite < concurrency &&
        bufferedBytes < AGGREGATE_MAX_BUFFERED_BYTES
      ) {
        const index = dispatched++;
        void this.fetchSliceOne(slices[index], target, headers, response, abortController.signal).then(
          (chunk) => {
            if (aborted.flag || abortController.signal.aborted) return;
            ready.set(index, chunk);
            bufferedBytes += chunk.length;
            void drain();
          },
          (error) => {
            if (aborted.flag || abortController.signal.aborted) return;
            aborted.flag = true;
            abortController.abort();
            if (!(error instanceof Error) || error.name !== 'AbortError') {
              this.ports.warn(`proxy /play 切片回源失败: ${error instanceof Error ? error.message : String(error)}`);
            }
            if (!response.writableEnded) response.destroy();
            resolveDone?.();
          },
        );
      }
    };

    const drain = async (): Promise<void> => {
      if (draining || aborted.flag || abortController.signal.aborted) return;
      draining = true;
      try {
        while (ready.has(nextWrite)) {
          const chunk = ready.get(nextWrite)!;
          ready.delete(nextWrite);
          bufferedBytes -= chunk.length;
          nextWrite++;
          if (!response.write(chunk)) {
            await new Promise<void>((resolve) => response.once('drain', resolve));
            if (aborted.flag || abortController.signal.aborted) return;
          }
        }
        maybeFinish();
      } finally {
        draining = false;
        if (!aborted.flag && !abortController.signal.aborted && !finished) dispatch();
      }
    };

    dispatch();
    await donePromise;
  }

  private async fetchSliceOne(
    slice: { start: number; end: number },
    target: string,
    headers: Record<string, string>,
    response: RangeResponseSink,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    const requestHeaders = { ...headers, Range: `bytes=${slice.start}-${slice.end}` };
    const expectedLength = slice.end - slice.start + 1;
    try {
      const chunk = await this.ports.fetchRange(target, requestHeaders, signal);
      if (chunk.length !== expectedLength) {
        if (signal?.aborted) {
          const aborted = new Error('CLIENT_CLOSE');
          aborted.name = 'AbortError';
          throw aborted;
        }
        const retry = await this.ports.fetchRange(target, requestHeaders, signal);
        if (retry.length === expectedLength) return retry;
        if (chunk.length >= expectedLength * 0.5) {
          this.ports.warn(`proxy /play 切片长度 ${chunk.length} != ${expectedLength}，截断容错`);
          return chunk.subarray(0, expectedLength);
        }
        throw new Error(`切片长度不符 ${chunk.length} != ${expectedLength} (${slice.start}-${slice.end})`);
      }
      return chunk;
    } catch (error) {
      if (response.destroyed || signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        const aborted = new Error('CLIENT_CLOSE');
        aborted.name = 'AbortError';
        throw aborted;
      }
      throw error;
    }
  }
}
