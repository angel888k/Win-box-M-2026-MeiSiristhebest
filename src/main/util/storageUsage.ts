import { lstat, opendir } from 'node:fs/promises';
import { join } from 'node:path';
import type { DataDirStorageUsage } from '../../shared/types';
import { SAFE_USERDATA_SUBDIRS } from './cacheClean';

const MAX_ENTRIES = 20_000;
const MAX_DEPTH = 32;
const APP_CACHE_NAME = 'winbox-cache';
const MEDIA_RUNTIME_NAME = 'media-runtimes';
const SPIDER_CACHE_NAME = 'spider';

type StorageCategory = 'retainedDataBytes' | 'browserCacheBytes' | 'spiderCacheBytes' | 'otherAppCacheBytes' | 'mediaRuntimeBytes';
export interface StorageUsageScanLimits {
  maxEntries?: number;
  maxDepth?: number;
}

/**
 * Estimates storage usage without reading file contents or following symlinks.
 * The scan is bounded so opening Settings cannot trigger an unbounded filesystem walk.
 */
export async function inspectDataDirStorage(root: string, limits: StorageUsageScanLimits = {}): Promise<DataDirStorageUsage> {
  const maxEntries = Math.max(1, limits.maxEntries ?? MAX_ENTRIES);
  const maxDepth = Math.max(1, limits.maxDepth ?? MAX_DEPTH);
  const usage: DataDirStorageUsage = {
    totalBytes: 0,
    retainedDataBytes: 0,
    browserCacheBytes: 0,
    spiderCacheBytes: 0,
    otherAppCacheBytes: 0,
    mediaRuntimeBytes: 0,
    complete: true,
    entriesScanned: 0,
  };
  const browserCacheNames = new Set(SAFE_USERDATA_SUBDIRS.map(name => name.toLowerCase()));

  const visit = async (directory: string, depth: number, category: StorageCategory): Promise<void> => {
    let handle: Awaited<ReturnType<typeof opendir>>;
    try {
      handle = await opendir(directory);
    } catch {
      usage.complete = false;
      return;
    }

    try {
      for await (const entry of handle) {
        if (usage.entriesScanned >= maxEntries) {
          usage.complete = false;
          break;
        }
        usage.entriesScanned += 1;
        // Never follow links: the profile may contain links outside the application data root.
        if (entry.isSymbolicLink()) {
          usage.complete = false;
          continue;
        }

        const child = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (depth >= maxDepth) {
            usage.complete = false;
            continue;
          }
          const childCategory = depth === 0
            ? classifyTopLevel(entry.name, browserCacheNames)
            : depth === 1 && category === 'otherAppCacheBytes' && entry.name.toLowerCase() === SPIDER_CACHE_NAME
              ? 'spiderCacheBytes'
              : category;
          await visit(child, depth + 1, childCategory);
          continue;
        }
        if (!entry.isFile()) continue;

        try {
          const size = (await lstat(child)).size;
          usage.totalBytes += size;
          usage[category] += size;
        } catch {
          usage.complete = false;
        }
      }
    } catch {
      usage.complete = false;
    }
  };

  await visit(root, 0, 'retainedDataBytes');
  return usage;
}

function classifyTopLevel(name: string, browserCacheNames: ReadonlySet<string>): StorageCategory {
  const normalized = name.toLowerCase();
  if (browserCacheNames.has(normalized)) return 'browserCacheBytes';
  if (normalized === APP_CACHE_NAME) return 'otherAppCacheBytes';
  if (normalized === MEDIA_RUNTIME_NAME) return 'mediaRuntimeBytes';
  return 'retainedDataBytes';
}
