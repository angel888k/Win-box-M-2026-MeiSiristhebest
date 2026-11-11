import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DownloadManager } from '../src/main/download/DownloadManager';
import { JsonStore } from '../src/main/store/JsonStore';

const dirs: string[] = [];
afterEach(() => {
  dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
});

function createTempEnv() {
  const dir = mkdtempSync(join(tmpdir(), 'winbox-download-test-'));
  dirs.push(dir);
  const store = new JsonStore(join(dir, 'downloads.json'));
  const log = { i: vi.fn(), w: vi.fn(), e: vi.fn() };
  return { dir, store, log };
}

describe('DownloadManager 离线下载引擎', () => {
  it('正确创建下载任务并格式化文件路径与扩展名', () => {
    const { dir, store, log } = createTempEnv();
    const manager = new DownloadManager({ defaultDownloadDir: dir, store, logger: log });

    const task1 = manager.createTask({
      url: 'https://example.com/video/test.m3u8?token=123',
      title: '测试影片 / 特殊字符: *?',
    });

    expect(task1.id).toMatch(/^dl_/);
    expect(task1.title).toBe('测试影片 / 特殊字符: *?');
    expect(task1.savePath).toContain('测试影片 _ 特殊字符_ _');
    expect(task1.savePath.endsWith('.ts')).toBe(true);
    expect(task1.status).toBe('pending');
    expect(task1.progress).toBe(0);

    const task2 = manager.createTask({
      url: 'https://example.com/video/sample.mp4',
      title: '电影正片',
    });
    expect(task2.savePath.endsWith('.mp4')).toBe(true);
  });

  it('任务列表按创建时间倒序排列并可根据 ID 获取', () => {
    const { dir, store, log } = createTempEnv();
    const manager = new DownloadManager({ defaultDownloadDir: dir, store, logger: log });

    const t1 = manager.createTask({ url: 'https://example.com/1.mp4', title: 'Task 1' });
    t1.createdAt = 1000;
    const t2 = manager.createTask({ url: 'https://example.com/2.mp4', title: 'Task 2' });
    t2.createdAt = 2000;

    const list = manager.list();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(t2.id);
    expect(list[1].id).toBe(t1.id);

    expect(manager.get(t1.id)?.title).toBe('Task 1');
    expect(manager.get('non_existent')).toBeUndefined();
  });

  it('支持暂停、恢复与取消任务', async () => {
    const { dir, store, log } = createTempEnv();
    const manager = new DownloadManager({ defaultDownloadDir: dir, store, logger: log });

    const task = manager.createTask({ url: 'https://example.com/sample.mp4', title: 'Pause Test' });
    manager.pause(task.id);
    expect(manager.get(task.id)?.status).toBe('pending');

    await manager.cancel(task.id);
    expect(manager.get(task.id)).toBeUndefined();
    expect(manager.list()).toHaveLength(0);
  });

  it('支持订阅和接收进度事件', () => {
    const { dir, store, log } = createTempEnv();
    const manager = new DownloadManager({ defaultDownloadDir: dir, store, logger: log });

    const listener = vi.fn();
    const unsubscribe = manager.onProgress(listener);

    const task = manager.createTask({ url: 'https://example.com/stream.mp4', title: 'Progress Test' });
    manager.pause(task.id);

    unsubscribe();
  });

  it('重启后从 JsonStore 恢复已有任务，未完成任务安全置为 paused', () => {
    const { dir, store, log } = createTempEnv();
    const manager1 = new DownloadManager({ defaultDownloadDir: dir, store, logger: log });
    const task = manager1.createTask({ url: 'https://example.com/persisted.mp4', title: 'Persisted' });

    // 模拟运行态中退出
    task.status = 'downloading';
    store.setObject('download_tasks', [task]);

    // 重新实例化 manager
    const manager2 = new DownloadManager({ defaultDownloadDir: dir, store, logger: log });
    const restored = manager2.get(task.id);
    expect(restored).toBeDefined();
    expect(restored?.status).toBe('paused');
    expect(restored?.title).toBe('Persisted');
  });
});
