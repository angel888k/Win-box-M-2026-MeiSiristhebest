// src/main/bootstrap/devReload.ts — 开发态 IPC 通道重启通信
import { app } from 'electron';
import { createConnection } from 'node:net';
import { fileLogger } from '../util/logger';

export function setupDevReload(): void {
  const pipe = process.env.WINBOX_DEV_RELOAD_PIPE;
  if (app.isPackaged || !pipe) return;
  const conn = createConnection(pipe);
  conn.setEncoding('utf8');
  let buf = '';
  conn.on('data', (chunk) => {
    buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const nl = buf.indexOf('\n');
    if (nl < 0) return;
    const cmd = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (cmd === 'quit') {
      fileLogger.i('开发重启：收到退出命令');
      conn.end();
      app.quit();
    }
  });
  conn.on('error', (err) => {
    fileLogger.w(`开发重启通道连接失败：${err.message}`);
  });
}
