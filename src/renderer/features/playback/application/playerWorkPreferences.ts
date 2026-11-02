import type { PlayerWorkPrefs } from './playerPreferences';
import type { SessionAudioPreferencePort } from './sessionAudioPreference';
import type { MpvAudioTrack, MpvSubtitleTrack } from '../../../../shared/player';

export interface PlayerWorkIdentityInput {
  title?: string;
  vodId?: string;
  sourceKey?: string;
  profileId?: string;
  season?: number;
}

/** Stable, URL-free preference identity shared by episodes of the same VOD. */
export function playerWorkPreferenceKey(input: PlayerWorkIdentityInput): string {
  const rawTitle = String(input.title || '').trim();
  const season = normalizeSeason(input.season) ?? seasonFromTitle(rawTitle);
  const sourceKey = String(input.sourceKey || '').trim().slice(0, 512);
  const vodId = String(input.vodId || '').trim().slice(0, 512);
  const profileId = String(input.profileId || '').trim().slice(0, 512);
  const title = normalizeWorkTitle(rawTitle);
  const profileScope = profileId ? `profile:${profileId}:` : '';
  // Source VOD IDs are commonly local to one subscription source. Prefer the
  // normalized work title so preferences follow the same work across sources;
  // fall back to source identity only when there is no usable title.
  const identity = title
    ? `title:${profileScope}${title}:season:${season ?? ''}`
    : sourceKey && vodId
      ? `id:${profileScope}${sourceKey}:${vodId}:season:${season ?? ''}`
      : '';
  if (!identity) return '';
  return `work-${hash(identity)}`;
}

export function audioPreferenceKey(track: MpvAudioTrack): string {
  const value = normalizeTrackParts([track.lang, track.title, track.codec, track.channels ? String(track.channels) : '']);
  return value ? `track-${hash(`audio:${value}`)}` : '';
}

export function subtitlePreferenceKey(track: MpvSubtitleTrack): string {
  const value = normalizeTrackParts([track.lang, track.title, track.codec]);
  return value ? `track-${hash(`subtitle:${value}`)}` : '';
}

/** Work-specific audio preference takes precedence; session preference remains the fallback. */
export function createWorkScopedAudioPreference(
  session: SessionAudioPreferencePort,
  workKey: string,
  preferences: { loadForWork?: (key: string) => PlayerWorkPrefs | null; saveForWork?: (key: string, patch: Partial<PlayerWorkPrefs>) => void },
): SessionAudioPreferencePort {
  return {
    readPreferredTrackKey: () => workKey
      ? preferences.loadForWork?.(workKey)?.audioTrackKey || session.readPreferredTrackKey()
      : session.readPreferredTrackKey(),
    rememberPreferredTrackKey: (key) => {
      const normalized = String(key || '').trim().slice(0, 160);
      session.rememberPreferredTrackKey(normalized);
      if (workKey && normalized) preferences.saveForWork?.(workKey, { audioTrackKey: normalized });
    },
  };
}

function normalizeWorkTitle(value: string): string {
  return value.normalize('NFKC')
    .replace(/(?:第\s*[零〇一二三四五六七八九十百两兩\d]+\s*[集话話回]|(?:S\s*\d{1,2}\s*)?E\s*P?\s*\d{1,4}|EP\s*\d{1,4}).*$/i, '')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .slice(0, 180);
}

function normalizeSeason(value: unknown): number | null {
  const season = Number(value);
  return Number.isInteger(season) && season > 0 && season <= 99 ? season : null;
}

function seasonFromTitle(value: string): number | null {
  const normalized = value.normalize('NFKC');
  const match = /(?:第\s*(\d{1,2})\s*季|\bS\s*(\d{1,2})(?=\s*E\s*P?\s*\d{1,4})|\bSeason\s*(\d{1,2})\b)/i.exec(normalized);
  return normalizeSeason(match?.[1] || match?.[2] || match?.[3]);
}

function normalizeTrackParts(parts: Array<string | number | undefined>): string {
  return parts.map(part => String(part ?? '').normalize('NFKC').trim().toLocaleLowerCase())
    .filter(Boolean).join('|').slice(0, 160);
}

function hash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return first.toString(36) + second.toString(36);
}
