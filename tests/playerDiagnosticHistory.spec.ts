import { describe, expect, it, vi } from 'vitest';
import {
  appendPlayerDiagnosticRecord,
  createPlayerDiagnosticRecord,
  normalizePlayerDiagnosticHistory,
  PLAYER_DIAGNOSTIC_HISTORY_LIMIT,
  recordPlayerDiagnostic,
} from '../src/renderer/features/playback/application/playerDiagnosticHistory';
import { createPlayerDiagnosticHistoryStorageAdapter } from '../src/renderer/features/playback/adapters/playerDiagnosticHistoryStorageAdapter';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe('bounded playback diagnostic history', () => {
  it('stores only redacted, bounded, structured fields', () => {
    const record = createPlayerDiagnosticRecord({
      title: '片名 https://media.example/item?token=private',
      sourceName: '来源 Cookie: session=private',
      engine: 'hls.js',
      message: 'HTTP 403 https://media.example/live.m3u8?auth=private',
    }, 1234);

    expect(record).toMatchObject({
      recordedAt: 1234,
      title: '片名 [链接已隐藏]',
      sourceName: '来源 Cookie=[已隐藏]',
      failure: { stage: 'authorization', engine: 'hls.js', httpStatus: 403 },
    });
    expect(JSON.stringify(record)).not.toContain('private');
    expect(JSON.stringify(record)).not.toContain('media.example');
  });

  it('deduplicates rapid identical retries and bounds the list', () => {
    const first = createPlayerDiagnosticRecord({ message: 'HTTP 404 失效' }, 1000);
    const duplicate = createPlayerDiagnosticRecord({ message: 'HTTP 404 失效' }, 2000);
    expect(appendPlayerDiagnosticRecord([first], duplicate)).toEqual([first]);

    let history = [first];
    for (let index = 1; index <= PLAYER_DIAGNOSTIC_HISTORY_LIMIT + 10; index += 1) {
      history = appendPlayerDiagnosticRecord(history, createPlayerDiagnosticRecord({ message: `HTTP 404 failure ${index}` }, 20_000 + index));
    }
    expect(history).toHaveLength(PLAYER_DIAGNOSTIC_HISTORY_LIMIT);
    expect(history[0].message).toContain('failure 60');
  });

  it('persists across adapter instances and clears without surfacing storage errors', () => {
    const storage = memoryStorage();
    const firstAdapter = createPlayerDiagnosticHistoryStorageAdapter(storage);
    recordPlayerDiagnostic({ message: 'HTTP 503 connection timeout' }, firstAdapter, 42);
    const reopenedAdapter = createPlayerDiagnosticHistoryStorageAdapter(storage);
    expect(reopenedAdapter.read()).toHaveLength(1);
    expect(reopenedAdapter.read()[0].failure.stage).toBe('network');
    reopenedAdapter.clear();
    expect(firstAdapter.read()).toEqual([]);

    const brokenStorage = {
      getItem: vi.fn(() => { throw new Error('storage unavailable'); }),
      setItem: vi.fn(() => { throw new Error('quota exceeded'); }),
      removeItem: vi.fn(() => { throw new Error('storage unavailable'); }),
    };
    const resilientAdapter = createPlayerDiagnosticHistoryStorageAdapter(brokenStorage);
    expect(() => recordPlayerDiagnostic({ message: 'error' }, resilientAdapter, 100)).not.toThrow();
    expect(resilientAdapter.read()).toEqual([]);
    expect(() => resilientAdapter.clear()).not.toThrow();
  });

  it('drops malformed persisted entries and sanitizes all fields when loading', () => {
    const valid = createPlayerDiagnosticRecord({ title: '视频', message: '未知错误' }, 5);
    const loaded = normalizePlayerDiagnosticHistory([
      valid,
      { ...valid, failure: { stage: 'fake', engine: 'unknown', retryable: false } },
      { ...valid, message: 'https://media.example/?token=secret' },
    ]);
    expect(loaded).toHaveLength(2);
    expect(loaded[1].message).toBe('[链接已隐藏]');
    expect(loaded[1].message).not.toContain('secret');
  });
});
