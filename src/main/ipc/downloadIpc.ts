// src/main/ipc/downloadIpc.ts
// 离线下载管理 IPC 适配器：向渲染层暴露下载列表、启动、暂停、恢复、取消与实时进度推送。
import { BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipc-channels';
import type { DownloadManager } from '../download/DownloadManager';
import type { Logger } from '../../shared/types';
import { registerHandler } from '../util/ipcGuard';

export function registerDownloadIpc(downloads: DownloadManager, logger: Logger): void {
  downloads.onProgress((event) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) {
        try {
          w.webContents.send(IPC.DOWNLOAD_PROGRESS, event);
        } catch {
          /* ignore */
        }
      }
    }
  });

  registerHandler(IPC.DOWNLOAD_LIST, () => downloads.list(), logger);
  registerHandler(IPC.DOWNLOAD_START, async (_e: unknown, options: { url: string; title: string; headers?: Record<string, string>; savePath?: string }) => {
    const task = downloads.createTask(options);
    await downloads.start(task.id);
    return task;
  }, logger);
  registerHandler(IPC.DOWNLOAD_PAUSE, (_e: unknown, id: string) => downloads.pause(String(id)), logger);
  registerHandler(IPC.DOWNLOAD_RESUME, async (_e: unknown, id: string) => downloads.resume(String(id)), logger);
  registerHandler(IPC.DOWNLOAD_CANCEL, async (_e: unknown, id: string, deleteFile?: boolean) => downloads.cancel(String(id), Boolean(deleteFile)), logger);
}
