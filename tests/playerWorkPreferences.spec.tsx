// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  audioPreferenceKey,
  createWorkScopedAudioPreference,
  playerWorkPreferenceKey,
  subtitlePreferenceKey,
} from '../src/renderer/features/playback/application/playerWorkPreferences';
import { DEFAULT_PLAYER_PREFS, type PlayerPreferencesPort } from '../src/renderer/features/playback/application/playerPreferences';
import { usePlayerPreferences } from '../src/renderer/features/playback/usePlayerPreferences';

describe('per-work playback preference identity', () => {
  it('shares exact normalized work titles across sources while separating seasons', () => {
    const first = playerWorkPreferenceKey({ title: '星河 S02E01', sourceKey: 'source-1', vodId: 'vod-7' });
    const second = playerWorkPreferenceKey({ title: '星河 S02E08', sourceKey: 'source-2', vodId: 'vod-23' });

    expect(first).toBe(second);
    expect(first).toMatch(/^work-[a-z0-9]+$/);
    expect(first).not.toContain('source-1');
    expect(first).not.toContain('vod-7');
    expect(playerWorkPreferenceKey({ title: '星河 S03E01', sourceKey: 'source-1', vodId: 'vod-7' })).not.toBe(first);
    expect(playerWorkPreferenceKey({ sourceKey: 'source-1', vodId: 'vod-7' })).not.toBe('');
    expect(playerWorkPreferenceKey({ sourceKey: 'source-2', vodId: 'vod-7' }))
      .not.toBe(playerWorkPreferenceKey({ sourceKey: 'source-1', vodId: 'vod-7' }));
  });

  it('isolates identical source and VOD identifiers across subscription profiles', () => {
    const common = { title: '星河 S02E01', sourceKey: 'source-1', vodId: 'vod-7' };
    const firstProfile = playerWorkPreferenceKey({ ...common, profileId: 'profile-a' });
    expect(playerWorkPreferenceKey({ ...common, profileId: 'profile-a' })).toBe(firstProfile);
    expect(playerWorkPreferenceKey({ ...common, profileId: 'profile-b' })).not.toBe(firstProfile);
    expect(playerWorkPreferenceKey({ title: '同名剧第1集', profileId: 'profile-b' }))
      .not.toBe(playerWorkPreferenceKey({ title: '同名剧第1集', profileId: 'profile-c' }));
  });

  it('falls back to a normalized title with episode suffix removed', () => {
    expect(playerWorkPreferenceKey({ title: '  My Show - S02E01  ' }))
      .toBe(playerWorkPreferenceKey({ title: 'my show - S02E12' }));
    expect(playerWorkPreferenceKey({ title: '第2季 星河 第01集' }))
      .toBe(playerWorkPreferenceKey({ title: '第2季 星河 第12集' }));
    expect(playerWorkPreferenceKey({ title: '' })).toBe('');
  });

  it('uses stable track metadata instead of transient engine track ids', () => {
    const audioA = { id: 1, lang: 'jpn', title: '日本語', codec: 'aac', channels: '2' };
    const audioB = { ...audioA, id: 9 };
    const subtitle = { id: 2, lang: 'chi', title: '简体中文', codec: 'ass' };

    expect(audioPreferenceKey(audioA)).toBe(audioPreferenceKey(audioB));
    expect(audioPreferenceKey(audioA)).toMatch(/^track-[a-z0-9]+$/);
    expect(subtitlePreferenceKey(subtitle)).toMatch(/^track-[a-z0-9]+$/);
    expect(subtitlePreferenceKey(subtitle)).not.toContain('简体中文');
  });

  it('uses the work audio choice first and remembers it for both work and session fallback', () => {
    let sessionKey = 'session-track';
    let workKey = '';
    const session = {
      readPreferredTrackKey: () => sessionKey,
      rememberPreferredTrackKey: (key: string) => { sessionKey = key; },
    };
    const preference = createWorkScopedAudioPreference(session, 'work-film', {
      loadForWork: () => workKey ? { audioTrackKey: workKey } : null,
      saveForWork: (_key, patch) => { workKey = patch.audioTrackKey || workKey; },
    });

    expect(preference.readPreferredTrackKey()).toBe('session-track');
    const selectedTrackKey = audioPreferenceKey({ id: 1, lang: 'jpn', codec: 'aac', channels: '2' });
    preference.rememberPreferredTrackKey(selectedTrackKey);
    expect(preference.readPreferredTrackKey()).toBe(selectedTrackKey);
    expect(sessionKey).toBe(selectedTrackKey);
  });
});

describe('per-work preference hook', () => {
  it('restores work overrides on mount and work changes, then falls back to global settings', () => {
    const workPrefs = new Map([
      ['work-a', { rate: 1.75, fit: 'cover' as const, subOffset: 3 }],
    ]);
    const storage: PlayerPreferencesPort = {
      load: vi.fn(() => ({ ...DEFAULT_PLAYER_PREFS, rate: 1.25, fit: 'contain' as const })),
      save: vi.fn(),
      loadForWork: vi.fn((key) => workPrefs.get(key) || null),
      saveForWork: vi.fn(),
    };

    const { result, rerender } = renderHook(({ workKey }) => usePlayerPreferences(storage, workKey), {
      initialProps: { workKey: 'work-a' },
    });
    expect(result.current.rate).toBe(1.75);
    expect(result.current.fit).toBe('cover');
    expect(result.current.initialSubtitleOffset).toBe(3);

    rerender({ workKey: 'work-b' });
    expect(result.current.rate).toBe(1.25);
    expect(result.current.fit).toBe('contain');
    expect(result.current.initialSubtitleOffset).toBe(0);

    act(() => result.current.syncPreferences(1.5));
    expect(storage.saveForWork).toHaveBeenCalledWith('work-b', { rate: 1.25, subOffset: 1.5, fit: 'contain' });
    expect(result.current.initialSubtitleOffset).toBe(1.5);

    rerender({ workKey: 'work-c' });
    expect(result.current.initialSubtitleOffset).toBe(0);
  });
});
