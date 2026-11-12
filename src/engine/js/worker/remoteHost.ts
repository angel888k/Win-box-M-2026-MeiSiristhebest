// src/engine/js/worker/remoteHost.ts
// worker 侧 JS 沙箱宿主端口：http 走消息往返；**同步** http/kv 走 SharedArrayBuffer + Atomics
// （worker 阻塞自己，主进程照常服务 —— 这正是修「同步 req 冻住整个软件」的关键）。
import type { MessagePort } from 'node:worker_threads';
import type { JsSandboxHostPort } from '../JsSandboxPort';
import type { HttpRequest, HttpResponse, KVStore, Logger } from '../../../shared/types';
import {
  SAB_HEADER,
  SAB_MAX_BYTES,
  SAB_REUSABLE_BYTES,
  resetSabForCall,
  waitForSabReply,
  type HostCall,
  type HostReply,
  type SabPayload,
} from './protocol';

/** 同步通道：重置状态与 Epoch → 写入请求 → Atomics.wait → 读回 JSON */
function sabRoundTripWithBuffer<T>(
  port: MessagePort,
  sab: SharedArrayBuffer,
  make: (sab: SharedArrayBuffer, id: number) => HostCall,
  timeoutMs: number,
  seq: () => number,
): SabPayload<T> {
  const id = seq();
  resetSabForCall(sab, id);
  const call = make(sab, id);
  try {
    port.postMessage(call);
  } catch (e) {
    return { ok: false, code: 'protocol', error: `同步通道投递失败: ${(e as Error).message}` };
  }
  return waitForSabReply<T>(sab, timeoutMs, '同步请求超时（主进程未及时响应）', id);
}

export interface RemoteHostOptions {
  jsLibDir: string;
  proxyBase: string;
}

/** Convert SAB transport failures into an explicit HTTP failure for legacy synchronous spider callers. */
export function responseForSabFailure(requestUrl: string, failure: SabPayload<unknown>): HttpResponse {
  const status = failure.code === 'oversized' ? 413 : failure.code === 'timeout' ? 504 : 502;
  return {
    status,
    headers: { 'x-winbox-sync-error-code': failure.code || 'protocol' },
    content: '',
    finalUrl: requestUrl,
  };
}

/**
 * 构造 worker 侧宿主。日志前缀由沙箱自身负责（`js:<key>` / `spider js:<key>`），这里原样转发。
 */
export function createRemoteHost(port: MessagePort, opts: RemoteHostOptions): JsSandboxHostPort {
  let seq = 0;
  const nextId = (): number => ++seq;
  const pending = new Map<number, { resolve: (r: HttpResponse) => void; reject: (e: Error) => void }>();

  // ★ 零分配常驻复用：每个 Worker 仅在启动时预分配唯一常驻 SAB
  // 单个 Worker 内同步阻塞严格串行（Atomics.wait 挂起），绝无并发重入冲突。
  // 99.9% 的普通同步 HTTP 请求使用 2MB 常驻缓冲区，消灭每次请求 new 8MB 的剧烈 GC 抖动。
  const reusableHttpSab = new SharedArrayBuffer(SAB_HEADER + SAB_REUSABLE_BYTES);
  // KV 存储仅存放简短字符串/Token，分配 64KB 常驻缓冲区即可。
  const reusableKvSab = new SharedArrayBuffer(SAB_HEADER + 64 * 1024);

  port.on('message', (msg: HostReply) => {
    if (!msg || (msg.t !== 'httpRes' && msg.t !== 'httpErr')) return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.t === 'httpRes') p.resolve(msg.res);
    else p.reject(new Error(msg.message));
  });

  const http = {
    request: (req: HttpRequest): Promise<HttpResponse> =>
      new Promise<HttpResponse>((resolve, reject) => {
        const id = nextId();
        pending.set(id, { resolve, reject });
        try {
          port.postMessage({ t: 'http', id, req } satisfies HostCall);
        } catch (e) {
          pending.delete(id);
          reject(e as Error);
        }
      }),
  };

  const logger: Logger = {
    i: (msg: string) => port.postMessage({ t: 'log', level: 'i', msg } satisfies HostCall),
    w: (msg: string) => port.postMessage({ t: 'log', level: 'w', msg } satisfies HostCall),
    e: (msg: string, err?: unknown) =>
      port.postMessage({ t: 'log', level: 'e', msg: err ? `${msg} | ${err instanceof Error ? err.stack ?? err.message : String(err)}` : msg } satisfies HostCall),
  };

  const kv: KVStore = {
    get: (key: string): string => {
      const r = sabRoundTripWithBuffer<string>(
        port,
        reusableKvSab,
        (sab, id) => ({ t: 'kv', id, op: 'get', key, sab }),
        5000,
        nextId,
      );
      if (!r.ok) logger.w(`同步 KV 读取失败（${key.slice(0, 100)}）：${r.error || '未知原因'}`);
      return r.ok && typeof r.value === 'string' ? r.value : '';
    },
    set: (key: string, val: string): void => {
      const r = sabRoundTripWithBuffer<string>(
        port,
        reusableKvSab,
        (sab, id) => ({ t: 'kv', id, op: 'set', key, val, sab }),
        5000,
        nextId,
      );
      if (!r.ok) logger.w(`同步 KV 写入失败（${key.slice(0, 100)}）：${r.error || '未知原因'}`);
    },
    delete: (key: string): void => {
      const r = sabRoundTripWithBuffer<string>(
        port,
        reusableKvSab,
        (sab, id) => ({ t: 'kv', id, op: 'delete', key, sab }),
        5000,
        nextId,
      );
      if (!r.ok) logger.w(`同步 KV 删除失败（${key.slice(0, 100)}）：${r.error || '未知原因'}`);
    },
  };

  /**
   * 同步 HTTP —— worker 侧阻塞等待（`Atomics.wait`），主进程异步执行后写入 SAB。
   * 优先使用 2MB 常驻缓冲；若命中超长响应（SAB_OVERSIZED），回退到一次性 8MB 临时缓冲区拉取主进程缓存。
   */
  const httpSync = (req: HttpRequest): HttpResponse => {
    const budget = Math.min((req.timeoutMs ?? 10000) + 2000, 60_000);
    let callId = 0;
    let r = sabRoundTripWithBuffer<HttpResponse>(
      port,
      reusableHttpSab,
      (sab, id) => {
        callId = id;
        return { t: 'httpSync', id, req, sab };
      },
      budget,
      nextId,
    );
    if (r.code === 'oversized') {
      // 遇到大于 2MB 的极少数响应：回退到一次性 8MB 缓冲区，向主进程请求转储已缓存的完整结果
      const tempSab = new SharedArrayBuffer(SAB_HEADER + SAB_MAX_BYTES);
      resetSabForCall(tempSab, callId);
      try {
        port.postMessage({ t: 'httpSyncOversized', id: callId, sab: tempSab } satisfies HostCall);
        r = waitForSabReply<HttpResponse>(tempSab, budget, '超大响应同步拉取超时', callId);
      } catch (e) {
        r = { ok: false, code: 'protocol', error: `超大同步响应获取失败: ${(e as Error).message}` };
      }
    }
    if (r.ok && r.value) return r.value;
    logger.w(`同步请求失败（${req.url.slice(0, 100)}）：${r.error || '未知原因'}`);
    return responseForSabFailure(req.url, r);
  };

  return { http, kv, logger, proxyBase: opts.proxyBase, jsLibDir: opts.jsLibDir, httpSync };
}
