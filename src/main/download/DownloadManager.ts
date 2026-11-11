// src/main/download/DownloadManager.ts
// ★ 本地视频离线下载引擎：支持直接流式媒体与 M3U8 分片批量并发下载。
// 任务状态持久化存储于本地，支持暂停、恢复、取消、实时测速与进度广播。
import { createWriteStream, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { request } from 'undici';
import type { DownloadProgressEvent, DownloadTask, DownloadTaskStatus, Logger } from '../../shared/types';
import type { JsonStore } from '../store/JsonStore';

export interface DownloadManagerDependencies {
  store?: JsonStore;
  defaultDownloadDir: string;
  logger: Pick<Logger, 'i' | 'w' | 'e'>;
}

interface ActiveJob {
  controller: AbortController;
  promise: Promise<void>;
}

export class DownloadManager {
  private readonly tasks = new Map<string, DownloadTask>();
  private readonly activeJobs = new Map<string, ActiveJob>();
  private readonly progressListeners = new Set<(event: DownloadProgressEvent) => void>();
  private readonly storeKey = 'download_tasks';

  constructor(private readonly dependencies: DownloadManagerDependencies) {
    this.loadTasksFromStore();
  }

  /** 获取全部下载任务列表（按创建时间倒序） */
  list(): DownloadTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => (b.createdAt - a.createdAt) || b.id.localeCompare(a.id));
  }

  /** 根据 ID 获取任务 */
  get(id: string): DownloadTask | undefined {
    return this.tasks.get(id);
  }

  /** 注册进度监听器 */
  onProgress(listener: (event: DownloadProgressEvent) => void): () => void {
    this.progressListeners.add(listener);
    return () => {
      this.progressListeners.delete(listener);
    };
  }

  /** 创建下载任务 */
  createTask(options: {
    url: string;
    title: string;
    headers?: Record<string, string>;
    savePath?: string;
  }): DownloadTask {
    const id = `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const sanitizedTitle = options.title.replace(/[\\/:*?"<>|]/g, '_').trim() || 'video';
    const isM3u8 = options.url.toLowerCase().includes('.m3u8');
    const ext = isM3u8 ? '.ts' : (options.url.match(/\.([a-z0-9]{3,4})(?:\?|$)/i)?.[1] ? `.${RegExp.$1}` : '.mp4');
    const filename = `${sanitizedTitle}_${id.slice(-4)}${ext}`;
    const targetDir = options.savePath ? dirname(options.savePath) : this.dependencies.defaultDownloadDir;

    if (!existsSync(targetDir)) {
      try { mkdirSync(targetDir, { recursive: true }); } catch { /* ignore */ }
    }

    const savePath = options.savePath || join(targetDir, filename);

    const task: DownloadTask = {
      id,
      title: options.title,
      url: options.url,
      headers: options.headers,
      savePath,
      status: 'pending',
      progress: 0,
      speedBytesPerSec: 0,
      downloadedBytes: 0,
      createdAt: Date.now(),
    };

    this.tasks.set(id, task);
    this.persistTasks();
    return task;
  }

  /** 开始执行任务 */
  async start(id: string): Promise<boolean> {
    const task = this.tasks.get(id);
    if (!task) return false;
    if (task.status === 'downloading') return true;

    const controller = new AbortController();
    const jobPromise = this.executeDownload(task, controller.signal);
    this.activeJobs.set(id, { controller, promise: jobPromise });
    return true;
  }

  /** 暂停任务 */
  pause(id: string): boolean {
    const job = this.activeJobs.get(id);
    const task = this.tasks.get(id);
    if (!task) return false;

    if (job) {
      job.controller.abort();
      this.activeJobs.delete(id);
    }

    if (task.status === 'downloading') {
      task.status = 'paused';
      task.speedBytesPerSec = 0;
      this.persistTasks();
      this.broadcastProgress(task);
    }
    return true;
  }

  /** 恢复任务 */
  async resume(id: string): Promise<boolean> {
    const task = this.tasks.get(id);
    if (!task) return false;
    if (task.status === 'completed') return true;
    return this.start(id);
  }

  /** 取消并删除任务 */
  async cancel(id: string, deleteFile = false): Promise<boolean> {
    this.pause(id);
    const task = this.tasks.get(id);
    if (!task) return false;

    task.status = 'cancelled';
    this.broadcastProgress(task);

    if (deleteFile && task.savePath && existsSync(task.savePath)) {
      try { unlinkSync(task.savePath); } catch { /* ignore */ }
    }

    this.tasks.delete(id);
    this.persistTasks();
    return true;
  }

  private async executeDownload(task: DownloadTask, signal: AbortSignal): Promise<void> {
    task.status = 'downloading';
    task.error = undefined;
    this.broadcastProgress(task);

    try {
      const isM3u8 = task.url.toLowerCase().includes('.m3u8');
      if (isM3u8) {
        await this.downloadM3u8(task, signal);
      } else {
        await this.downloadDirectStream(task, signal);
      }

      if (!signal.aborted) {
        task.status = 'completed';
        task.progress = 100;
        task.speedBytesPerSec = 0;
        task.completedAt = Date.now();
        this.persistTasks();
        this.broadcastProgress(task);
      }
    } catch (error) {
      if (signal.aborted) {
        task.status = 'paused';
      } else {
        task.status = 'failed';
        task.error = error instanceof Error ? error.message : String(error);
        this.dependencies.logger.e(`下载任务 [${task.id}] 失败: ${task.error}`);
      }
      task.speedBytesPerSec = 0;
      this.persistTasks();
      this.broadcastProgress(task);
    } finally {
      this.activeJobs.delete(task.id);
    }
  }

  /** 直接 HTTP 流式下载 */
  private async downloadDirectStream(task: DownloadTask, signal: AbortSignal): Promise<void> {
    const fileDir = dirname(task.savePath);
    if (!existsSync(fileDir)) mkdirSync(fileDir, { recursive: true });

    const fileStream = createWriteStream(task.savePath, { flags: 'w' });
    const reqHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WinBox/1.28',
      ...(task.headers || {}),
    };

    const res = await request(task.url, {
      headers: reqHeaders,
      signal,
    });

    if (res.statusCode < 200 || res.statusCode >= 300) {
      fileStream.close();
      throw new Error(`HTTP 状态码异常: ${res.statusCode}`);
    }

    const contentLength = Number(res.headers['content-length']);
    if (Number.isFinite(contentLength) && contentLength > 0) {
      task.totalBytes = contentLength;
    }

    let lastTime = Date.now();
    let bytesInWindow = 0;

    for await (const chunk of res.body) {
      if (signal.aborted) {
        fileStream.close();
        return;
      }
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      fileStream.write(buffer);
      task.downloadedBytes += buffer.length;
      bytesInWindow += buffer.length;

      const now = Date.now();
      const elapsed = now - lastTime;
      if (elapsed >= 500) {
        task.speedBytesPerSec = Math.round((bytesInWindow / elapsed) * 1000);
        if (task.totalBytes && task.totalBytes > 0) {
          task.progress = Math.min(99, Math.round((task.downloadedBytes / task.totalBytes) * 100));
        }
        bytesInWindow = 0;
        lastTime = now;
        this.broadcastProgress(task);
      }
    }

    fileStream.end();
  }

  /** M3U8 分片批量下载拼合 */
  private async downloadM3u8(task: DownloadTask, signal: AbortSignal): Promise<void> {
    const fileDir = dirname(task.savePath);
    if (!existsSync(fileDir)) mkdirSync(fileDir, { recursive: true });

    const reqHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) WinBox/1.28',
      ...(task.headers || {}),
    };

    // 1. 获取 M3U8 文本
    const res = await request(task.url, { headers: reqHeaders, signal });
    if (res.statusCode !== 200) {
      throw new Error(`获取 M3U8 播放列表失败 HTTP ${res.statusCode}`);
    }
    const text = await res.body.text();

    // 2. 解析分片 URL
    const rawLines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const segmentUrls: string[] = [];
    const baseUri = new URL(task.url);

    // 如果是 Master Playlist，挑选第一个流地址递归获取
    const streamInfoLine = rawLines.find(l => !l.startsWith('#') && (l.includes('.m3u8') || !l.includes('.ts')));
    if (text.includes('#EXT-X-STREAM-INF') && streamInfoLine) {
      const nestedUrl = new URL(streamInfoLine, baseUri).toString();
      const nestedRes = await request(nestedUrl, { headers: reqHeaders, signal });
      const nestedText = await nestedRes.body.text();
      const nestedLines = nestedText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      for (const line of nestedLines) {
        if (!line.startsWith('#')) {
          segmentUrls.push(new URL(line, new URL(nestedUrl)).toString());
        }
      }
    } else {
      for (const line of rawLines) {
        if (!line.startsWith('#')) {
          segmentUrls.push(new URL(line, baseUri).toString());
        }
      }
    }

    if (segmentUrls.length === 0) {
      throw new Error('未在 M3U8 中发现可下载的视频分片');
    }

    // 3. 顺序追加写入目标文件
    const fileStream = createWriteStream(task.savePath, { flags: 'w' });
    let completedSegments = 0;
    let lastTime = Date.now();
    let bytesInWindow = 0;

    for (const segUrl of segmentUrls) {
      if (signal.aborted) {
        fileStream.close();
        return;
      }

      const segRes = await request(segUrl, { headers: reqHeaders, signal });
      if (segRes.statusCode >= 200 && segRes.statusCode < 300) {
        for await (const chunk of segRes.body) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          fileStream.write(buf);
          task.downloadedBytes += buf.length;
          bytesInWindow += buf.length;
        }
      } else {
        await segRes.body.dump();
      }

      completedSegments++;
      task.progress = Math.min(99, Math.round((completedSegments / segmentUrls.length) * 100));

      const now = Date.now();
      const elapsed = now - lastTime;
      if (elapsed >= 500) {
        task.speedBytesPerSec = Math.round((bytesInWindow / elapsed) * 1000);
        bytesInWindow = 0;
        lastTime = now;
        this.broadcastProgress(task);
      }
    }

    fileStream.end();
  }

  private broadcastProgress(task: DownloadTask): void {
    const event: DownloadProgressEvent = {
      id: task.id,
      status: task.status,
      progress: task.progress,
      speedBytesPerSec: task.speedBytesPerSec,
      downloadedBytes: task.downloadedBytes,
      totalBytes: task.totalBytes,
      error: task.error,
    };
    for (const listener of this.progressListeners) {
      try { listener(event); } catch { /* ignore */ }
    }
  }

  private persistTasks(): void {
    if (!this.dependencies.store) return;
    try {
      this.dependencies.store.setObject(this.storeKey, Array.from(this.tasks.values()));
    } catch {
      /* ignore persistence error */
    }
  }

  private loadTasksFromStore(): void {
    if (!this.dependencies.store) return;
    try {
      const saved = this.dependencies.store.getObject<DownloadTask[]>(this.storeKey, []);
      if (Array.isArray(saved)) {
        for (const item of saved) {
          if (item && item.id) {
            // 重启后如果仍为 downloading 则置为 paused
            const status: DownloadTaskStatus = item.status === 'downloading' ? 'paused' : item.status;
            this.tasks.set(item.id, { ...item, status, speedBytesPerSec: 0 });
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
}
