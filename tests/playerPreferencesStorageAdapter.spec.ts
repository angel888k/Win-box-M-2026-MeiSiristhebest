// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PLAYER_PREFS } from '../src/renderer/features/playback/application/playerPreferences';
import { loadPlayerPrefs, loadPlayerWorkPrefs, savePlayerPrefs, savePlayerWorkPrefs } from '../src/renderer/lib/playerPrefs';

const STORAGE_KEY = 'winbox-player-prefs';
const WORK_STORAGE_KEY = 'winbox-player-work-prefs-v1';

afterEach(() => {
  localStorage.clear();
});

describe('player preferences browser storage adapter', () => {
  it('returns normalized defaults when storage is empty or malformed', () => {
    expect(loadPlayerPrefs()).toEqual(DEFAULT_PLAYER_PREFS);
    localStorage.setItem(STORAGE_KEY, '{broken');
    expect(loadPlayerPrefs()).toEqual(DEFAULT_PLAYER_PREFS);
  });

  it('merges a partial preference update without losing the other saved values', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULT_PLAYER_PREFS, rate: 1.5, kernel: 'mpv' }));

    savePlayerPrefs({ vol: 0.4 });

    expect(loadPlayerPrefs()).toMatchObject({ vol: 0.4, rate: 1.5, kernel: 'mpv' });
  });

  it('stores only bounded work playback preferences and rejects URL-shaped keys', () => {
    const workKey = 'work-a1b2';
    const unsafePatch = Object.assign({
      rate: 1.75,
      fit: 'cover' as const,
      subOffset: 2.5,
      audioTrackKey: 'track-a1b2',
      subtitleTrackKey: 'https://cdn.invalid/subtitle.ass?token=secret',
    }, { url: 'https://media.invalid/video.m3u8?token=secret', cookie: 'secret' });
    savePlayerWorkPrefs(workKey, unsafePatch);

    expect(loadPlayerWorkPrefs(workKey)).toEqual({
      rate: 1.75,
      fit: 'cover',
      subOffset: 2.5,
      audioTrackKey: 'track-a1b2',
    });
    expect(loadPlayerWorkPrefs('https://media.invalid/video.m3u8?token=secret')).toBeNull();
    const serialized = localStorage.getItem(WORK_STORAGE_KEY) || '';
    expect(serialized).not.toContain('https://media.invalid');
    expect(serialized).not.toContain('secret');
  });

  it('keeps only the newest 100 work records', () => {
    for (let index = 0; index < 105; index++) {
      savePlayerWorkPrefs(`work-${index.toString(36)}`, { rate: 1 + index / 100 });
    }

    const store = JSON.parse(localStorage.getItem(WORK_STORAGE_KEY) || '{}') as Record<string, unknown>;
    expect(Object.keys(store)).toHaveLength(100);
    expect(loadPlayerWorkPrefs('work-2w')).toMatchObject({ rate: 2.04 });
    expect(loadPlayerWorkPrefs('work-0')).toBeNull();
  });
});
