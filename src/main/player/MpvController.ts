// src/main/player/MpvController.ts
// ★ 2026-10-08（用户拍板「内置官方构建」）：MPV 高兼容播放内核的主进程侧 —— 单会话管理。
//
// 生命周期：渲染层 `mpvStart` → spawn mpv（`--wid` 钉进播放器窗口）→ 等 JSON IPC 管道就绪 →
//   下发属性观察 + `loadfile`；状态由 mpv 事件驱动（节流 200ms 推给渲染层）；`mpvStop`/换集/
//   关窗口/退出应用都会 quit + 兜底 kill，绝不留下孤儿进程。
//
// 单会话是刻意的：同一时刻只有「独立播放器窗口」的一个 mpv；同窗换集优先复用进程，失败则完整重启。
import { spawn, type ChildProcess } from 'node:child_process';
import { connect, type Socket } from 'node:net';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import type { Logger } from '../../shared/types';
import { normalizeSpdif, type MpvCommand, type MpvKernelState, type MpvShaderRenderStatus, type MpvStartOptions, type MpvStatus } from '../../shared/player';
import { IPC } from '../../shared/ipc-channels';
import { cacheDir, resourcesDir } from '../util/paths';
import { playerSettings } from './playerSettings';
import { playerIsFullscreen, playerIsMini } from './PlayerWindow';
import {
  buildMpvArgs,
  initialKernelState,
  mpvCmdLine,
  mpvCommandLines,
  mpvObserveLines,
  inspectMpvShaderPasses,
  mpvShadersCmd,
  mpvShaderPassDescriptions,
  reduceMpvMessage,
  resolveMpvPath,
} from './mpvCore';

/** 状态推送节流（mpv 的 time-pos 事件很密；200ms ≈ 进度条刷新率，够用） */
const PUSH_INTERVAL_MS = 200;
/** IPC 管道连接总超时（mpv 启动到建管道通常 <1s） */
const CONNECT_TIMEOUT_MS = 6000;
/** quit 后的强杀宽限 */
const QUIT_GRACE_MS = 1500;
/** MPV JSON IPC command replies normally arrive immediately; bound slow/broken pipes. */
const COMMAND_ACK_TIMEOUT_MS = 3000;

type MpvIpcReply = { accepted: boolean; data?: unknown; error?: string };

/** 取窗口 HWND（Windows 指针宽度的十进制字符串，mpv `--wid` 接受十进制 int64） */
export function hwndOf(win: BrowserWindow): string {
  try {
    const buf = win.getNativeWindowHandle();
    if (buf.length >= 8) return buf.readBigUInt64LE(0).toString();
    return String(buf.readUInt32LE(0));
  } catch {
    return '';
  }
}

export class MpvController {
  private proc: ChildProcess | null = null;
  private sock: Socket | null = null;
  private state: MpvKernelState = initialKernelState();
  private session = 0;
  private target: BrowserWindow | null = null;
  private pushTimer: NodeJS.Timeout | null = null;
  private retiring = new Set<ChildProcess>();
  private pipeSeq = 0;
  private nextCommandRequestId = 0;
  private lineBuf = '';
  private readonly pendingCommandAcks = new Map<number, {
    session: number;
    timer: NodeJS.Timeout;
    resolve(reply: MpvIpcReply | null): void;
  }>();
  private shaderCommandChain: Promise<void> = Promise.resolve();
  private reloading = false;
  private startRequest = 0;
  /**
   * `start()` can be called twice before the first process has finished
   * connecting (React effect cleanup/start does exactly that when the kernel
   * is switched).  Serialising the whole start operation prevents the second
   * call from missing the first process and leaving two mpv instances alive.
   */
  private startChain: Promise<void> = Promise.resolve();
  private unbindViewport: (() => void) | null = null;
  /** 本次会话是否已挂上外挂字幕（换字幕前先 sub-remove） */
  private subOn = false;
  private pendingSeekSec: number | null = null;
  private seekThrottleTimer: NodeJS.Timeout | null = null;
  onPlaybackStarted?: () => void;

  constructor(private log: Logger) {}

  /** mpv 可用性与路径（配置覆盖 → 随包内置 → 本机探测） */
  status(): MpvStatus {
    const bundled = join(resourcesDir(), 'mpv', 'mpv.exe');
    const r = resolveMpvPath({
      override: playerSettings.settings.mpvPath,
      bundled,
      env: process.env,
      exists: existsSync,
    });
    const note =
      r.source === 'override'
        ? '使用自定义路径'
        : r.source === 'bundled'
          ? '使用随包内置构建（安装目录内）'
          : r.source === 'system'
            ? '使用本机已安装的 mpv'
            : '未找到 mpv：随包构建缺失且本机未安装（可在配置页「播放」指定 mpv.exe 路径）';
    return { available: r.source !== 'none', path: r.path, source: r.source, note };
  }

  get running(): boolean {
    return !!this.proc;
  }

  /**
   * 启动一次 mpv 会话（换集/换源 = 新会话）。
   * 注意：本方法返回时 mpv 已 `loadfile` 目标地址；状态经 MPV_STATE 事件持续推送。
   */
  async start(win: BrowserWindow, opts: MpvStartOptions): Promise<{ session: number; path: string }> {
    const reuseSession = opts?.reuseSession === true;
    if (!reuseSession) this.stop();
    const request = ++this.startRequest;
    const reservation = this.session;
    const run = this.startChain.then(async () => {
      if (request !== this.startRequest) return { session: this.session, path: this.status().path };
      if (reuseSession && this.proc && this.sock && this.target === win && !win.isDestroyed()) {
        try {
          return await this.reloadInternal(opts);
        } catch (error) {
          if (request !== this.startRequest) return { session: this.session, path: this.status().path };
          this.log.w(`mpv: 同进程切换失败，回退完整重启：${error instanceof Error ? error.message : String(error)}`);
          this.stopSession();
          return this.startInternal(win, opts, this.session);
        }
      }
      if (reservation !== this.session && !reuseSession) return { session: reservation, path: this.status().path };
      if (reuseSession) this.stopSession();
      return this.startInternal(win, opts, reuseSession ? this.session : reservation);
    });
    // Keep the queue usable after a failed start, while returning the actual
    // result/error to the caller that requested this start.
    this.startChain = run.then(() => undefined, () => undefined);
    return run;
  }

  private async startInternal(win: BrowserWindow, opts: MpvStartOptions, reservation: number): Promise<{ session: number; path: string }> {
    const st = this.status();
    if (!st.available) throw new Error(st.note);
    const url = String(opts?.url || '').trim();
    if (!url) throw new Error('播放地址为空');

    if (reservation !== this.session || win.isDestroyed()) return { session: reservation, path: st.path };
    // A retiring process must release the embedded HWND before another VO attaches to it.
    await Promise.all([...this.retiring].map(proc => new Promise<void>(resolve => {
      if (proc.exitCode !== null || proc.signalCode !== null) { resolve(); return; }
      const timer = setTimeout(() => {
        try { proc.kill(); } catch { /* ignore */ }
        resolve();
      }, 2000);
      proc.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    })));
    if (reservation !== this.session || win.isDestroyed()) return { session: reservation, path: st.path };
    this.session += 1;
    const session = this.session;
    this.target = win;
    this.state = initialKernelState(!!opts.live);
    this.reloading = false;
    this.subOn = false;
    this.lineBuf = '';

    const hwnd = hwndOf(win);
    if (!hwnd) throw new Error('无法取得播放器窗口句柄（mpv 无法嵌入）');
    const pipe = `\\\\.\\pipe\\winbox-mpv-${process.pid}-${++this.pipeSeq}-${Date.now().toString(36)}`;
    const args = buildMpvArgs({
      pipe,
      wid: hwnd,
      start: opts.startTime,
      volume: opts.volume ?? 1,
      rate: opts.rate ?? 1,
      fit: opts.fit,
    });
    this.log.i(`mpv: 启动（session=${session}，${st.note}）→ ${url.slice(0, 120)}`);
    const proc = spawn(st.path, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = proc;
    proc.on('error', (e) => {
      this.log.w(`mpv: 进程错误 ${e.message}`);
      if (session === this.session) this.markExited();
    });
    proc.on('exit', (code) => {
      this.log.i(`mpv: 进程退出 code=${String(code)}`);
      if (session === this.session) this.markExited();
    });
    const onOut = (chunk: Buffer): void => {
      for (const line of String(chunk).split(/\r?\n/)) {
        const s = line.trim();
        if (s) this.log.w(`mpv: ${s.slice(0, 200)}`);
      }
    };
    proc.stdout?.on('data', onOut);
    proc.stderr?.on('data', onOut);

    let sock: Socket;
    try { sock = await this.connectPipe(pipe, CONNECT_TIMEOUT_MS); }
    catch (e) { if (proc === this.proc) this.stop(); throw e; }
    // 连接期间可能已被 stop/换集 → 丢弃这条管道
    if (session !== this.session || proc !== this.proc) {
      try {
        sock.destroy();
      } catch {
        /* ignore */
      }
      return { session, path: st.path };
    }
    this.sock = sock;
    const updateViewport = () => {
      if (session !== this.session || win.isDestroyed()) return;
      const height = win.getContentBounds().height;
      const titleHeight = playerIsFullscreen() ? 0 : playerIsMini() ? 18 : 38;
      sock.write(mpvCmdLine(['set_property', 'video-margin-ratio-top', titleHeight / Math.max(1, height)]));
      win.webContents.invalidate();
    };
    win.on('resize', updateViewport);
    win.on('enter-full-screen', updateViewport);
    win.on('leave-full-screen', updateViewport);
    this.unbindViewport = () => {
      win.removeListener('resize', updateViewport);
      win.removeListener('enter-full-screen', updateViewport);
      win.removeListener('leave-full-screen', updateViewport);
    };
    updateViewport();
    sock.on('data', (d: Buffer) => {
      if (sock !== this.sock || proc !== this.proc) return;
      this.onSockData(d, this.session);
    });
    sock.on('error', () => {
      this.clearCommandAcks();
    if (this.seekThrottleTimer) {
      clearTimeout(this.seekThrottleTimer);
      this.seekThrottleTimer = null;
    }
    this.pendingSeekSec = null;
    });
    sock.on('close', () => {
      if (this.sock === sock) this.sock = null;
      this.clearCommandAcks();
    if (this.seekThrottleTimer) {
      clearTimeout(this.seekThrottleTimer);
      this.seekThrottleTimer = null;
    }
    this.pendingSeekSec = null;
    });
    sock.write(mpvObserveLines().join(''));
    sock.write(mpvCmdLine(['set_property', 'mute', 'no']));
    sock.write(mpvCmdLine(['set_property', 'pause', opts.paused ? 'yes' : 'no']));
    sock.write(mpvCmdLine(['set_property', 'volume', Math.max(0, Math.min(1, opts.volume ?? 1)) * 100]));
    // 超分插件：等待 MPV 对每条列表命令的 JSON IPC 回执，再开始加载媒体。
    const shaders = (opts.shaders ?? []).map((s) => String(s ?? '').trim()).filter(Boolean);
    if (shaders.length && !(await this.replaceShaderChain(shaders, session))) {
      this.log.w('mpv: 初始着色器列表未获命令回执；继续播放，但超分尚未确认');
    }
    if (session !== this.session || proc !== this.proc) return { session, path: st.path };
    const spdif = normalizeSpdif(opts.spdif);
    if (spdif) sock.write(mpvCmdLine(['set_property', 'audio-spdif', spdif]));
    sock.write(mpvCmdLine(['loadfile', url, 'replace']));
    return { session, path: st.path };
  }

  /** Load another item into the same MPV process, with a new renderer session token. */
  private async reloadInternal(opts: MpvStartOptions): Promise<{ session: number; path: string }> {
    const sock = this.sock;
    const win = this.target;
    const proc = this.proc;
    const url = String(opts?.url || '').trim();
    if (!sock || !win || win.isDestroyed() || !proc || proc.exitCode !== null || proc.signalCode !== null || !url) {
      throw new Error('当前 MPV 会话不可复用');
    }

    this.session += 1;
    const session = this.session;
    this.clearCommandAcks();
    if (this.seekThrottleTimer) {
      clearTimeout(this.seekThrottleTimer);
      this.seekThrottleTimer = null;
    }
    this.pendingSeekSec = null;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = null;
    this.state = initialKernelState(!!opts.live);
    this.reloading = true;
    this.subOn = false;
    this.pushNow();

    // Pause the old item while applying the next item's settings. loadfile's
    // file-local start option seeks before playback begins.
    sock.write(mpvCmdLine(['set_property', 'pause', 'yes']));
    const volume = Math.max(0, Math.min(1, opts.volume ?? 1));
    for (const line of mpvCommandLines({ type: 'volume', value: volume })) sock.write(line);
    for (const line of mpvCommandLines({ type: 'rate', value: opts.rate ?? 1 })) sock.write(line);
    for (const line of mpvCommandLines({ type: 'fit', value: opts.fit || 'contain' })) sock.write(line);
    for (const line of mpvCommandLines({ type: 'audio-spdif', value: normalizeSpdif(opts.spdif) })) sock.write(line);

    const shaders = (opts.shaders ?? []).map(path => String(path || '').trim()).filter(Boolean);
    if (!(await this.replaceShaderChain(shaders, session))) throw new Error('MPV 未确认新媒体的着色器设置');
    if (session !== this.session || sock !== this.sock || proc !== this.proc) throw new Error('MPV 会话已被替换');

    const startTime = Number(opts.startTime);
    const loadOptions = Number.isFinite(startTime) && startTime > 0 ? { start: String(startTime) } : undefined;
    const command: unknown[] = ['loadfile', url, 'replace'];
    if (loadOptions) command.push(-1, loadOptions);
    const reply = await this.sendCommandAndWait(sock, session, command);
    if (!reply?.accepted) throw new Error('MPV 未接受新媒体地址');
    if (session !== this.session || sock !== this.sock || proc !== this.proc) throw new Error('MPV 会话已被替换');
    sock.write(mpvCmdLine(['set_property', 'pause', opts.paused ? 'yes' : 'no']));
    return { session, path: this.status().path };
  }

  /** 控制命令（成功只代表已写入管道） */
  command(cmd: MpvCommand): boolean {
    const sock = this.sock;
    if (!sock) return false;
    try {
      if (cmd?.type === 'sub-add') {
        const text = String(cmd.text || '');
        if (!text.trim()) return false;
        const dir = join(cacheDir(), 'mpv');
        mkdirSync(dir, { recursive: true });
        const file = join(dir, 'subtitle.srt');
        writeFileSync(file, text, 'utf-8');
        if (this.subOn) sock.write(mpvCmdLine(['sub-remove']));
        sock.write(mpvCmdLine(['sub-add', file, 'select']));
        this.subOn = true;
        return true;
      }
      if (cmd?.type === 'sub-clear') {
        if (this.subOn) sock.write(mpvCmdLine(['sub-remove']));
        this.subOn = false;
        return true;
      }
      if (cmd?.type === 'seek') {
        const sec = Number(cmd.value) || 0;
        this.pendingSeekSec = sec;
        if (!this.seekThrottleTimer) {
          this.seekThrottleTimer = setTimeout(() => {
            this.seekThrottleTimer = null;
            if (this.pendingSeekSec !== null && this.sock) {
              const targetSec = this.pendingSeekSec;
              this.pendingSeekSec = null;
              try {
                this.sock.write(mpvCmdLine(['seek', targetSec, 'absolute']));
              } catch {
                /* ignore */
              }
            }
          }, 16);
        }
        return true;
      }
      const lines = mpvCommandLines(cmd);
      if (!lines.length) return false;
      for (const l of lines) sock.write(l);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Replace the MPV shader list and wait for protocol replies. A successful
   * result proves that MPV accepted the list commands, not that a VO rendered
   * those shaders; `vo-passes` is not supported by every output backend.
   */
  replaceShaders(paths: readonly string[]): Promise<boolean> {
    const session = this.session;
    const run = this.shaderCommandChain.then(() => this.replaceShaderChain(paths, session));
    this.shaderCommandChain = run.then(() => undefined, () => undefined);
    return run;
  }

  /** Query one bounded snapshot of active render passes; this is not a polling subscription. */
  readShaderRenderStatus(paths: readonly string[]): Promise<MpvShaderRenderStatus> {
    const session = this.session;
    const run = this.shaderCommandChain.then(() => this.readShaderRenderStatusNow(paths, session));
    this.shaderCommandChain = run.then(() => undefined, () => undefined);
    return run;
  }

  private async readShaderRenderStatusNow(paths: readonly string[], session: number): Promise<MpvShaderRenderStatus> {
    const sock = this.sock;
    if (!sock || session !== this.session) return { state: 'no-session' };
    const shaderPaths = [...new Set(paths.map((path) => String(path || '').trim()).filter(Boolean))].slice(0, 64);
    if (!shaderPaths.length) return { state: 'unavailable', detail: '当前档位没有可加载的着色器文件。' };

    const sources = await Promise.all(shaderPaths.map(async (path) => {
      try { return await readFile(path, 'utf8'); } catch { return ''; }
    }));
    const expectedDescriptions = [...new Set(sources.flatMap(mpvShaderPassDescriptions))].slice(0, 512);
    const reply = await this.sendCommandAndWait(sock, session, ['get_property', 'vo-passes']);
    if (!reply) return { state: 'unavailable', detail: '读取 MPV 渲染状态超时或通信管道已关闭。' };
    if (!reply.accepted) {
      return { state: 'unsupported', detail: reply.error || '当前 MPV 输出后端不支持 vo-passes 查询。' };
    }
    return inspectMpvShaderPasses(reply.data, expectedDescriptions);
  }

  private async replaceShaderChain(paths: readonly string[], session: number): Promise<boolean> {
    const sock = this.sock;
    if (!sock || session !== this.session) return false;
    const commands = mpvShadersCmd(paths).map((line) => {
      const parsed = JSON.parse(line) as { command: unknown[] };
      return parsed.command;
    });
    for (const command of commands) {
      if (session !== this.session || sock !== this.sock) return false;
      const reply = await this.sendCommandAndWait(sock, session, command);
      if (!reply?.accepted) return false;
    }
    return true;
  }

  private sendCommandAndWait(sock: Socket, session: number, command: unknown[]): Promise<MpvIpcReply | null> {
    const requestId = ++this.nextCommandRequestId;
    return new Promise<MpvIpcReply | null>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingCommandAcks.delete(requestId);
        resolve(null);
      }, COMMAND_ACK_TIMEOUT_MS);
      this.pendingCommandAcks.set(requestId, { session, timer, resolve });
      try {
        sock.write(`${JSON.stringify({ command, request_id: requestId })}\n`);
      } catch {
        clearTimeout(timer);
        this.pendingCommandAcks.delete(requestId);
        resolve(null);
      }
    });
  }

  private settleCommandAck(message: unknown, session: number): boolean {
    if (!message || typeof message !== 'object') return false;
    const response = message as { request_id?: unknown; error?: unknown; data?: unknown };
    if (!Number.isSafeInteger(response.request_id)) return false;
    const requestId = response.request_id as number;
    const pending = this.pendingCommandAcks.get(requestId);
    if (!pending || pending.session !== session) return false;
    clearTimeout(pending.timer);
    this.pendingCommandAcks.delete(requestId);
    pending.resolve({
      accepted: response.error === 'success' && session === this.session,
      data: response.data,
      error: typeof response.error === 'string' ? response.error : undefined,
    });
    return true;
  }

  private clearCommandAcks(): void {
    for (const [id, pending] of this.pendingCommandAcks) {
      clearTimeout(pending.timer);
      pending.resolve(null);
      this.pendingCommandAcks.delete(id);
    }
  }

  /** 停止会话（quit → 宽限后强杀；幂等） */
  stop(): void {
    this.startRequest += 1;
    this.stopSession();
  }

  private stopSession(): void {
    this.unbindViewport?.();
    this.unbindViewport = null;
    const sock = this.sock;
    const proc = this.proc;
    this.sock = null;
    this.proc = null;
    this.target = null;
    this.reloading = false;
    this.session += 1; // 在途事件/连接立即作废
    this.clearCommandAcks();
    if (this.seekThrottleTimer) {
      clearTimeout(this.seekThrottleTimer);
      this.seekThrottleTimer = null;
    }
    this.pendingSeekSec = null;
    if (this.pushTimer) {
      clearTimeout(this.pushTimer);
      this.pushTimer = null;
    }
    try {
      sock?.write(mpvCmdLine(['quit']));
    } catch {
      /* ignore */
    }
    try {
      sock?.end();
    } catch {
      /* ignore */
    }
    if (proc && !proc.killed && proc.exitCode === null && proc.signalCode === null) {
      this.retiring.add(proc);
      const quitTimer = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          /* ignore */
        }
      }, QUIT_GRACE_MS);
      proc.once('exit', () => {
        clearTimeout(quitTimer);
        this.retiring.delete(proc);
      });
    }
    this.state = initialKernelState();
    this.subOn = false;
  }

  /** 退出应用（index.ts will-quit） */
  dispose(): void {
    this.stop();
  }

  // ---- 内部 ----

  private async connectPipe(pipe: string, timeoutMs: number): Promise<Socket> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const ok = await new Promise<Socket | null>((resolve) => {
        const s = connect(pipe);
        const onErr = (): void => {
          s.removeListener('connect', onOk);
          s.destroy();
          resolve(null);
        };
        const onOk = (): void => {
          s.removeListener('error', onErr);
          resolve(s);
        };
        s.once('error', onErr);
        s.once('connect', onOk);
      });
      if (ok) return ok;
      if (Date.now() > deadline) throw new Error('mpv 通信管道连接超时（进程可能启动失败）');
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  private onSockData(d: Buffer, session: number): void {
    if (session !== this.session) return;
    this.lineBuf += String(d);
    const lines = this.lineBuf.split('\n');
    this.lineBuf = lines.pop() || '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (this.settleCommandAck(msg, session)) continue;
      const event = msg && typeof msg === 'object' && 'event' in msg
        ? (msg as { event?: unknown }).event
        : undefined;
      if (this.reloading) {
        if (event !== 'start-file' && event !== 'file-loaded' && event !== 'end-file') continue;
        this.reloading = false;
      }
      const hadPlaybackStarted = this.state.playbackStarted;
      const changed = reduceMpvMessage(this.state, msg);
      if (this.state.playbackStarted && !hadPlaybackStarted) {
        try { this.onPlaybackStarted?.(); } catch { /* ignore */ }
      }
      if (!changed) continue;
      // A state such as `loaded` remains true for the whole playback. Use the
      // transition event to keep ordinary time/track updates on the 200ms path.
      this.schedulePush(event === 'file-loaded' || event === 'end-file' || this.state.exited);
    }
  }

  private markExited(): void {
    if (this.state.exited) return;
    this.state.exited = true;
    this.schedulePush(true);
  }

  private schedulePush(immediate: boolean): void {
    if (immediate) {
      if (this.pushTimer) clearTimeout(this.pushTimer);
      this.pushTimer = null;
      this.pushNow();
      return;
    }
    if (this.pushTimer) return;
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null;
      this.pushNow();
    }, PUSH_INTERVAL_MS);
  }

  private pushNow(): void {
    const w = this.target;
    if (!w || w.isDestroyed()) return;
    try {
      w.webContents.send(IPC.MPV_STATE, { session: this.session, state: { ...this.state } });
    } catch {
      /* 窗口已关：忽略 */
    }
  }
}
