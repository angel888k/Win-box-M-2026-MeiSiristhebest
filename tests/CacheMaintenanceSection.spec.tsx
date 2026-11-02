// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataDirInfo } from '../src/shared/types';
import type { CacheMaintenancePort } from '../src/renderer/features/settings/application/settingsSectionPorts';
import { CacheMaintenanceSection } from '../src/renderer/features/settings/CacheMaintenanceSection';

const dataDir: DataDirInfo = {
  path: 'C:/Users/test/AppData/Win-Box',
  planned: 'C:/Users/test/AppData/Win-Box',
  mode: 'dev',
  storageUsage: {
    totalBytes: 1024,
    retainedDataBytes: 400,
    browserCacheBytes: 100,
    spiderCacheBytes: 100,
    otherAppCacheBytes: 300,
    mediaRuntimeBytes: 124,
    complete: true,
    entriesScanned: 12,
  },
};

describe('CacheMaintenanceSection', () => {
  afterEach(cleanup);

  it('loads data directory only while active', async () => {
    const port: CacheMaintenancePort = {
      loadDataDirectory: vi.fn().mockResolvedValue(dataDir),
      clearCache: vi.fn().mockResolvedValue({ freedBytes: 0, cleared: [], failed: [] }),
    };
    const { rerender } = render(<CacheMaintenanceSection active={false} port={port} />);

    expect(port.loadDataDirectory).not.toHaveBeenCalled();
    rerender(<CacheMaintenanceSection active port={port} />);

    expect(await screen.findByText('C:/Users/test/AppData/Win-Box')).toBeTruthy();
    expect(screen.getByText('数据目录总占用')).toBeTruthy();
    expect(screen.getByText('1.0 KB')).toBeTruthy();
    expect(screen.getByText('Spider 转换缓存（本操作会清理）')).toBeTruthy();
    expect(screen.getByText(/此操作仅清空 Chromium 缓存和 Spider 转换缓存/)).toBeTruthy();
    expect(screen.getByText('媒体播放器运行时（MPV、FFmpeg；本操作保留）')).toBeTruthy();
    expect(port.loadDataDirectory).toHaveBeenCalledTimes(1);
  });

  it('refreshes storage usage on demand', async () => {
    const port: CacheMaintenancePort = {
      loadDataDirectory: vi.fn().mockResolvedValue(dataDir),
      clearCache: vi.fn().mockResolvedValue({ freedBytes: 0, cleared: [], failed: [] }),
    };
    render(<CacheMaintenanceSection active port={port} />);

    await screen.findByText('数据目录总占用');
    fireEvent.click(screen.getByRole('button', { name: '刷新占用' }));

    await waitFor(() => expect(port.loadDataDirectory).toHaveBeenCalledTimes(2));
  });

  it('shows both the active and planned paths when the install data directory falls back', async () => {
    const fallbackInfo: DataDirInfo = {
      ...dataDir,
      path: 'C:/Users/test/AppData/Roaming/win-box',
      planned: 'E:/Win-Box/data',
      mode: 'fallback',
      reason: '安装目录不可写',
    };
    const port: CacheMaintenancePort = {
      loadDataDirectory: vi.fn().mockResolvedValue(fallbackInfo),
      clearCache: vi.fn().mockResolvedValue({ freedBytes: 0, cleared: [], failed: [] }),
    };
    render(<CacheMaintenanceSection active port={port} />);

    expect(await screen.findByText('C:/Users/test/AppData/Roaming/win-box')).toBeTruthy();
    expect(screen.getByText('E:/Win-Box/data')).toBeTruthy();
    expect(document.body.textContent).toContain('回退使用：安装目录不可写');
  });

  it('reports cleanup success and keeps the action disabled while cleanup is pending', async () => {
    let finishCleanup!: (result: { freedBytes: number; cleared: string[]; failed: string[] }) => void;
    const cleanupResult = new Promise<{ freedBytes: number; cleared: string[]; failed: string[] }>((resolve) => { finishCleanup = resolve; });
    const port: CacheMaintenancePort = {
      loadDataDirectory: vi.fn().mockResolvedValue(dataDir),
      clearCache: vi.fn(() => cleanupResult),
    };
    render(<CacheMaintenanceSection active port={port} />);

    const button = screen.getByRole('button', { name: '清理可重建缓存' });
    fireEvent.click(button);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: '正在清理…' })).toBeTruthy();

    await act(async () => finishCleanup({ freedBytes: 1_572_864, cleared: ['image', 'temp'], failed: ['locked'] }));

    expect(await screen.findByText(/已清理 2 类缓存，释放约 1.5 MB（1 项暂被占用跳过）/)).toBeTruthy();
    expect((screen.getByRole('button', { name: '清理可重建缓存' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('reports data-directory and cleanup failures in the view', async () => {
    const port: CacheMaintenancePort = {
      loadDataDirectory: vi.fn().mockRejectedValue(new Error('profile unavailable')),
      clearCache: vi.fn().mockRejectedValue(new Error('disk is read-only')),
    };
    render(<CacheMaintenanceSection active port={port} />);

    expect(await screen.findByText('读取数据目录失败：profile unavailable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '清理可重建缓存' }));

    await waitFor(() => expect(screen.getByText('清理失败：disk is read-only')).toBeTruthy());
    expect((screen.getByRole('button', { name: '清理可重建缓存' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
