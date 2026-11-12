import type { PlayResult, SourceBean } from '../../shared/types';
import type { SourceExecutionContextValue, SourceExecutionResolverPort } from './SourceExecutionContext';
import { throwIfAborted } from '../../engine/util/abort';
import { directPlayUrlError } from '../../shared/playbackResult';
import { wrapPlayUrlWithHeaders } from '../../shared/driveProvider';

const NEXT_EPISODE_PREWARM_TIMEOUT_MS = 12_000;

export interface PlaybackRequestDiagnostic extends Record<string, unknown> {
  kind: 'play';
  stage: 'done' | 'failed';
  ok: boolean;
  ms: number;
  key: string;
  flag: string;
  ep: string;
  parse?: number;
  needBind?: string;
  msg?: string;
  url?: string;
  reason?: string;
}

export interface SpiderPlaybackRequestPorts {
  execution: SourceExecutionResolverPort;
  playback: {
    execute(key: string, flag: string, id: string, context: SourceExecutionContextValue, source: SourceBean, parseOffset?: number, fastRecovery?: boolean): Promise<PlayResult>;
    prewarm(source: SourceBean, flag: string, id: string, vipFlags: string[], signal?: AbortSignal): Promise<PlayResult>;
  };
  startTimer(): { ms(): number };
  episodeFingerprint(id: string): string;
  safeUrlSummary(url: string): string;
  directPlayUrlError(url: string): string;
  recordDiagnostic(event: PlaybackRequestDiagnostic): void;
  notePlaybackFailure?(key: string): void;
}

/** Resolves a profile-scoped playback request and records diagnostics around the playback use case. */
export class SpiderPlaybackRequestService {
  constructor(private readonly ports: SpiderPlaybackRequestPorts) {}

  async execute(key: string, flag: string, id: string, profileId?: string, parseOffset?: number, fastRecovery = false): Promise<PlayResult> {
    const timer = this.ports.startTimer();
    try {
      const context = this.ports.execution.forProfile(profileId);
      const source: SourceBean | null = this.ports.execution.forSource(context, key);
      if (!source) throw new Error(`源不存在: ${key}`);

      let result = parseOffset !== undefined || fastRecovery
        ? await this.ports.playback.execute(key, flag, id, context, source, parseOffset, fastRecovery)
        : await this.ports.playback.execute(key, flag, id, context, source);
      if (result.parse === 0) {
        const error = this.ports.directPlayUrlError(result.url);
        if (error) result = { ...result, parse: 1, url: '', playUrl: '', message: result.message || error };
      }
      const isOk = result.parse === 0 && !!result.url;
      if (!isOk) {
        this.ports.notePlaybackFailure?.(key);
      }
      this.record({
        kind: 'play',
        stage: 'done',
        ok: isOk,
        ms: timer.ms(),
        key,
        flag,
        ep: this.ports.episodeFingerprint(id),
        parse: result.parse,
        needBind: result.needDriveCookieBind,
        msg: result.message ? String(result.message).slice(0, 120) : undefined,
        url: result.url ? this.ports.safeUrlSummary(result.url) : undefined,
      });
      return result;
    } catch (error) {
      this.ports.notePlaybackFailure?.(key);
      this.record({
        kind: 'play',
        stage: 'failed',
        ok: false,
        ms: timer.ms(),
        key,
        flag,
        ep: this.ports.episodeFingerprint(id),
        reason: String((error as Error)?.message ?? error).slice(0, 200),
      });
      throw error;
    }
  }

  /** Resolve one bounded, direct media URL without cloud-drive transfer or parser fallback side effects. */
  async prewarm(key: string, flag: string, id: string, profileId?: string, signal?: AbortSignal): Promise<PlayResult | null> {
    throwIfAborted(signal);
    const context = this.ports.execution.forProfile(profileId);
    const source = this.ports.execution.forSource(context, key);
    if (!source) throw new Error(`源不存在: ${key}`);
    const timeoutSignal = AbortSignal.timeout(NEXT_EPISODE_PREWARM_TIMEOUT_MS);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    let result: PlayResult;
    try {
      result = await waitForSignal(
        this.ports.playback.prewarm(source, flag, id, context.config?.flags || [], requestSignal),
        requestSignal,
      );
    } catch (error) {
      throwIfAborted(signal);
      if (timeoutSignal.aborted) return null;
      throw error;
    }
    throwIfAborted(signal);
    if (timeoutSignal.aborted) return null;
    if (result.parse !== 0 || result.jx) return null;
    const mediaUrl = String(result.url || '').trim();
    if (directPlayUrlError(mediaUrl) || !isRemoteMediaUrl(mediaUrl)) return null;
    return { ...result, url: wrapPlayUrlWithHeaders(mediaUrl, result.header || {}) };
  }

  private record(event: PlaybackRequestDiagnostic): void {
    try {
      this.ports.recordDiagnostic(event);
    } catch {
      // Diagnostics must never replace the playback result or its original error.
    }
  }
}

async function waitForSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new Error('下一集预解析已取消'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

function isRemoteMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    if (['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase())) return false;
    if (/\/proxy(?:\/|$)/i.test(url.pathname) || /(?:^|[?&])do=pan(?:&|$)/i.test(url.search)) return false;
    return true;
  } catch {
    return false;
  }
}
