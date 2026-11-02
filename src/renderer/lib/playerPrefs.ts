// src/renderer/lib/playerPrefs.ts
// ★ 2026-09-24（用户要求）：**播放器设置记忆** —— 下次打开播放器保持上次的设置。
//   这里只负责「纯渲染层」的几项（localStorage，主窗口与独立播放器窗口同源共享）：
//     · 音量（0 = 静音；与播放器内「点喇叭」的实现一致，不用 video.muted）
//     · 倍速
//     · 字幕时间偏移
//   ★ 不在此重复持久化的项：字幕字号/位置/开关（主进程 subtitleSet → subtitle.json）、
//     弹幕设置（主进程 danmakuSet → danmaku.json），二者已是跨窗口持久的。
import {
  DEFAULT_PLAYER_PREFS,
  normalizePlayerWorkPrefs,
  normalizePlayerPrefs,
  type PlayerPrefs,
  type PlayerWorkPrefs,
} from '../features/playback/application/playerPreferences';

export {
  DEFAULT_PLAYER_PREFS,
  normalizeFit,
  normalizeKernelPref,
  normalizePlayerWorkPrefs,
  PLAYER_FITS,
  type PlayerFit,
  type PlayerPrefs,
  type PlayerWorkPrefs,
} from '../features/playback/application/playerPreferences';

const KEY = 'winbox-player-prefs';

/** 读取记忆（坏 JSON / 部分字段缺失都能安全回退逐字段默认值） */
export function loadPlayerPrefs(): PlayerPrefs {
  try {
    const j = localStorage.getItem(KEY);
    return j ? normalizePlayerPrefs(JSON.parse(j)) : { ...DEFAULT_PLAYER_PREFS };
  } catch {
    return { ...DEFAULT_PLAYER_PREFS };
  }
}

/** 保存记忆（局部更新，未给的字段保持原值） */
export function savePlayerPrefs(patch: Partial<PlayerPrefs>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadPlayerPrefs(), ...patch }));
  } catch {
    /* 隐私模式/配额满 → 静默忽略（记忆失效不影响播放） */
  }
}

const WORK_KEY = 'winbox-player-work-prefs-v1';
const MAX_WORK_PREFERENCES = 100;

function readWorkStore(): Record<string, { prefs: PlayerWorkPrefs; updatedAt: number }> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(WORK_KEY) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const store: Record<string, { prefs: PlayerWorkPrefs; updatedAt: number }> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (!/^work-[a-z0-9]+$/.test(key) || !entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const record = entry as { prefs?: unknown; updatedAt?: unknown };
      const prefs = normalizePlayerWorkPrefs(record.prefs);
      if (Object.keys(prefs).length === 0) continue;
      store[key] = { prefs, updatedAt: Number.isFinite(record.updatedAt) ? Number(record.updatedAt) : 0 };
    }
    return store;
  } catch {
    return {};
  }
}

export function loadPlayerWorkPrefs(workKey: string): PlayerWorkPrefs | null {
  if (!/^work-[a-z0-9]+$/.test(workKey)) return null;
  return readWorkStore()[workKey]?.prefs ?? null;
}

/** Persist only bounded, validated playback preferences, never media addresses or credentials. */
export function savePlayerWorkPrefs(workKey: string, patch: Partial<PlayerWorkPrefs>): void {
  if (!/^work-[a-z0-9]+$/.test(workKey)) return;
  try {
    const store = readWorkStore();
    const previous = store[workKey]?.prefs ?? {};
    const prefs = normalizePlayerWorkPrefs({ ...previous, ...patch });
    if (Object.keys(prefs).length === 0) return;
    const mostRecentUpdate = Object.values(store).reduce((latest, entry) => Math.max(latest, entry.updatedAt), 0);
    store[workKey] = { prefs, updatedAt: Math.max(Date.now(), mostRecentUpdate + 1) };
    const retained = Object.entries(store)
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
      .slice(0, MAX_WORK_PREFERENCES);
    localStorage.setItem(WORK_KEY, JSON.stringify(Object.fromEntries(retained)));
  } catch {
    /* Storage limits or privacy mode must not interfere with playback. */
  }
}
