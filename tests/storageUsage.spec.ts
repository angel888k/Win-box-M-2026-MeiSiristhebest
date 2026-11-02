import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { inspectDataDirStorage } from '../src/main/util/storageUsage';

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'winbox-storage-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('inspectDataDirStorage', () => {
  it('reports a non-overlapping estimate for retained data, clearable caches, app cache, and media runtimes', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'user-config.json'), Buffer.alloc(4));
    mkdirSync(join(root, 'WebStorage'), { recursive: true });
    writeFileSync(join(root, 'WebStorage', 'database.db'), Buffer.alloc(9));
    mkdirSync(join(root, 'Cache'), { recursive: true });
    writeFileSync(join(root, 'Cache', 'poster.cache'), Buffer.alloc(5));
    mkdirSync(join(root, 'winbox-cache', 'spider'), { recursive: true });
    writeFileSync(join(root, 'winbox-cache', 'spider', 'converted.jar'), Buffer.alloc(6));
    mkdirSync(join(root, 'winbox-cache', 'python'), { recursive: true });
    writeFileSync(join(root, 'winbox-cache', 'python', 'python.exe'), Buffer.alloc(7));
    mkdirSync(join(root, 'media-runtimes', 'ffmpeg'), { recursive: true });
    writeFileSync(join(root, 'media-runtimes', 'ffmpeg', 'ffmpeg.exe'), Buffer.alloc(8));

    const usage = await inspectDataDirStorage(root);

    expect(usage).toMatchObject({
      totalBytes: 39,
      retainedDataBytes: 13,
      browserCacheBytes: 5,
      spiderCacheBytes: 6,
      otherAppCacheBytes: 7,
      mediaRuntimeBytes: 8,
      complete: true,
    });
    expect(usage.retainedDataBytes + usage.browserCacheBytes + usage.spiderCacheBytes + usage.otherAppCacheBytes + usage.mediaRuntimeBytes).toBe(usage.totalBytes);
  });

  it('marks a bounded scan as incomplete and returns a lower-bound total', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'a.bin'), Buffer.alloc(3));
    writeFileSync(join(root, 'b.bin'), Buffer.alloc(5));

    const usage = await inspectDataDirStorage(root, { maxEntries: 1 });

    expect(usage.complete).toBe(false);
    expect(usage.entriesScanned).toBe(1);
    expect(usage.totalBytes).toBeLessThan(8);
  });
});
