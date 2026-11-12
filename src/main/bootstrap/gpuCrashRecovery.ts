// src/main/bootstrap/gpuCrashRecovery.ts — GPU 崩溃监控与安全退避自愈
import { app, BrowserWindow, webContents } from 'electron';
import { fileLogger } from '../util/logger';
import { lastMediaSummary, lastMediaWcId } from '../util/mediaDiag';

/**
 * ★ 2026-10-16（用户报「播放时画面突然消失、软件只剩声音」）★★
 *
 * 证据：10-16 日志里唯一非 jvm 异常 = `child-process-gone type=GPU reason=crashed exitCode=34`；
 *   症状完全吻合 —— GPU 子进程（合成器）死掉后整窗内容不再刷新（连进度条都不动），
 *   音频走另一条通道继续 ⇒ 用户看到的就是「画面消失、只剩声音」。Chromium 不会自愈（不会自动补拉 GPU 进程）。
 *
 * ① 恢复：GPU 崩溃后**主动 reload 一次「最后在播放的那个窗口」**。
 *    · 目标 = 渲染层最近一次上报的窗口（见 util/mediaDiag）→ 回退播放器窗 → 回退主窗；
 *    · 播放器窗 reload 后由它自己的 `did-finish-load` + `pendingInit` 重发最后一发 init ⇒ 自动续播；
 *      主窗是 hash 路由，reload 后仍停在原页面（不会跳到首页）。
 *    · 退避：60s 滑动窗口内 GPU 崩溃 ≥3 次 → 只记日志、不再自动重载（避免与坏驱动形成「崩→载→崩」风暴）。
 * ② 诊断：日志带上崩溃前的最后一条播放事件（渲染层上报），否则永远只有一行 GPU 崩溃、无从定位。
 * ③ 有意不做：不重启整个应用（会丢播放器窗、宿主与蜘蛛状态）；不动渲染策略。
 */
const gpuCrashAt: number[] = [];

/** 退避判定（本次计入）：60s 内第 3 次及以后不再自动重载 */
function gpuRecoverAllowed(): boolean {
  const now = Date.now();
  while (gpuCrashAt.length && now - gpuCrashAt[0] > 60_000) gpuCrashAt.shift();
  gpuCrashAt.push(now);
  return gpuCrashAt.length < 3;
}

/** 恢复目标 = 最后在播放的那个窗口 → 播放器窗 → 主窗（都没有则 null） */
function gpuRecoveryTarget(
  mainWindowProvider: () => BrowserWindow | null,
  playerWindowProvider: () => BrowserWindow | null,
): BrowserWindow | null {
  const id = lastMediaWcId();
  if (id != null) {
    const wc = webContents.fromId(id);
    const w = wc ? BrowserWindow.fromWebContents(wc) : null;
    if (w && !w.isDestroyed()) return w;
  }
  const pw = playerWindowProvider();
  if (pw && !pw.isDestroyed()) return pw;
  const mw = mainWindowProvider();
  return mw && !mw.isDestroyed() ? mw : null;
}

export function setupGpuCrashRecovery(
  mainWindowProvider: () => BrowserWindow | null,
  playerWindowProvider: () => BrowserWindow | null,
): void {
  // 原生崩溃此前没有应用日志；记录进程类型/退出码，不记录资源 URL 或凭据。
  app.on('web-contents-created', (_event, contents) => {
    contents.on('render-process-gone', (_e, details) => {
      fileLogger.w(`renderer-gone wc=${contents.id} reason=${details.reason} exitCode=${details.exitCode}`);
    });
    contents.on('unresponsive', () => fileLogger.w(`renderer-unresponsive wc=${contents.id}`));
  });

  app.on('child-process-gone', (_event, details) => {
    let suffix = '';
    if (details.type === 'GPU') {
      suffix = ` | ${lastMediaSummary()}`;
      if (!gpuRecoverAllowed()) {
        suffix += ' | 退避：60s 内第 3 次及以上 GPU 崩溃 → 只记日志、不自动重载';
      } else {
        const target = gpuRecoveryTarget(mainWindowProvider, playerWindowProvider);
        if (!target) {
          suffix += ' | 未找到可重载的窗口（无播放上报且主窗已关）→ 不恢复';
        } else {
          const wcId = target.webContents.id;
          // 稍等再 reload：给 Chromium 一点时间重建 GPU 进程，立刻 reload 可能又撞上未就绪的合成器
          setTimeout(() => {
            try {
              if (!target.isDestroyed()) target.webContents.reload();
            } catch {
              /* ignore */
            }
          }, 800);
          suffix += ` | 已触发 GPU 崩溃恢复：800ms 后重载窗口（wc=${wcId}）`;
        }
      }
    }
    fileLogger.w(`child-process-gone type=${details.type} reason=${details.reason} exitCode=${details.exitCode}${suffix}`);
  });
}
