/**
 * Intelligent Episode and Season Normalizer.
 * Inspired by MoviePilot's `metavideo.py` and `words.py`.
 *
 * Normalizes messy scraper titles (e.g. `[4K超清] 庆余年.S02E05.2024.HDR`, `第05集 决战`,
 * `EP05-06连播`, `2024-05-10期`, `SP01`) into structured metadata for precise cross-source
 * episode alignment and clean UI presentation.
 */

export interface NormalizedEpisodeInfo {
  raw: string;
  season: number | null;
  episode: number | null;
  episodeEnd: number | null;
  dateOrdinal: string | null; // e.g. "20240510" for variety shows
  isSpecial: boolean;
  cleanTitle: string;
}

const NOISE_TAGS = [
  // Brackets and group tags: [xxx], (xxx), 【xxx】, （xxx）
  /\[[^\]]*\]/g,
  /\([^)]*\)/g,
  /【[^】]*】/g,
  /（[^）]*）/g,
];

const NOISE_WORDS = [
  // Resolution & Dynamic Range
  /\b(?:2160p|1440p|1080p|1080i|720p|576p|480p|4k|8k|uhd|fhd|hd|sd)\b/gi,
  /\b(?:hdr10\+?|hdr|hlg|dolby[\s._-]*(?:vision)?|dovi|dv)\b/gi,
  /(?:4k|1080p|720p|超清|高清|标清|蓝光|原画|杜比视界|杜比音效)/gi,

  // Codecs & Formats
  /\b(?:x264|h264|x265|h265|hevc|avc|av1|vc-1|vp9|10bit|8bit)\b/gi,

  // Audio formats
  /\b(?:dts(?:-hd)?|truehd|atmos|aac(?:\d\.\d)?|flac|ac3|ddp\+?|dd|mp3)\b/gi,

  // Source / Rip types
  /\b(?:web-?dl|web-?rip|bluray|blu-?ray|remux|bdrip|dvdrip|hdtv|tvrip|dvd)\b/gi,

  // Common Chinese noise descriptors
  /(?:中英双字|中文字幕|国粤双语|双语字幕|官方双语|内嵌字幕|简繁中字|纯净版|抢先版|修复版|无删减版?|未删减版?|加长版|导演剪辑版|典藏版|重制版|正片|电影版|完结|全集|连播)/gi,

  // File extensions
  /\.(?:mkv|mp4|ts|m2ts|avi|rmvb|flv|mov|wmv|webm)$/i,
];

const CHINESE_DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9,
};

export function parseChineseNumber(value: string): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);

  let total = 0;
  let current = 0;
  for (const char of trimmed) {
    if (char in CHINESE_DIGITS) {
      current = CHINESE_DIGITS[char];
      continue;
    }
    if (char === '十') {
      total += (current || 1) * 10;
      current = 0;
      continue;
    }
    if (char === '百') {
      total += (current || 1) * 100;
      current = 0;
      continue;
    }
    return null;
  }
  const result = total + current;
  return Number.isFinite(result) && result > 0 ? result : null;
}

/**
 * Normalizes an episode title string into structured metadata.
 */
export function normalizeEpisodeInfo(raw: string): NormalizedEpisodeInfo {
  const text = (raw || '').normalize('NFKC').trim();
  let season: number | null = null;
  let episode: number | null = null;
  let episodeEnd: number | null = null;
  let dateOrdinal: string | null = null;
  let isSpecial = false;

  // 1. Detect Special / OVA / Extra
  if (/(?:^|[^\p{L}\p{N}])(?:SP|OVA|OAD|特别篇|番外篇?|彩蛋|花絮|前传)/iu.test(text)) {
    isSpecial = true;
    const spMatch = /(?:SP|OVA|OAD|特别篇|番外篇?)\s*0*(\d{1,3})/i.exec(text);
    if (spMatch) {
      episode = Number(spMatch[1]);
    }
  }

  // 2. Season parsing
  // S01E05 or S01 or Season 01
  const sPattern = /\bS(?:EASON)?\s*0*(\d{1,2})(?=[Ee\D]|$)/i.exec(text);
  if (sPattern) {
    season = Number(sPattern[1]);
  } else {
    // 第X季 / 第X部
    const cnSeason = /第\s*([0-9零〇一二三四五六七八九十百两兩]+)\s*[季部]/i.exec(text);
    if (cnSeason) {
      season = parseChineseNumber(cnSeason[1]);
    }
  }

  // 3. Variety show date format (e.g. 2024-05-10, 2024.05.10, 20240510)
  const sepDateMatch = /(?:^|\D)((?:19|20)\d{2})[-.年/](1[0-2]|0?[1-9])[-.月/]([12]\d|3[01]|0?[1-9])[日号期\s]?/i.exec(text);
  if (sepDateMatch) {
    const fullYear = Number(sepDateMatch[1]);
    const month = String(Number(sepDateMatch[2])).padStart(2, '0');
    const day = String(Number(sepDateMatch[3])).padStart(2, '0');
    dateOrdinal = `${fullYear}${month}${day}`;
  } else {
    const rawDateMatch = /(?:^|\D)((?:19|20)\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?=\D|$)/.exec(text);
    if (rawDateMatch) {
      dateOrdinal = `${rawDateMatch[1]}${rawDateMatch[2]}${rawDateMatch[3]}`;
    }
  }

  // 4. Episode parsing (if not already extracted by special)
  if (episode == null) {
    // S01E05 or S1E5 or E05 or EP05
    const seMatch = /\b(?:S\s*\d{1,2}\s*)?E(?:P)?\s*0*(\d{1,4})(?:\s*[-~+到至]\s*(?:E(?:P)?)?\s*0*(\d{1,4}))?\b/i.exec(text);
    if (seMatch) {
      episode = Number(seMatch[1]);
      if (seMatch[2]) episodeEnd = Number(seMatch[2]);
    }
  }

  if (episode == null) {
    // 01x05 format
    const xMatch = /(?:^|[^\p{L}\p{N}])0*(\d{1,2})\s*[xX]\s*0*(\d{1,4})(?=$|[^\p{L}\p{N}])/u.exec(text);
    if (xMatch) {
      season = Number(xMatch[1]);
      episode = Number(xMatch[2]);
    }
  }

  if (episode == null) {
    // 第X集 / 第X话 / 第X期 / 第X回
    const cnEp = /第\s*([0-9零〇一二三四五六七八九十百两兩]+)\s*[集话話期回](?:\s*[-~+到至连播]\s*(?:第)?\s*([0-9零〇一二三四五六七八九十百两兩]+)\s*[集话話期回]?)?/i.exec(text);
    if (cnEp) {
      episode = parseChineseNumber(cnEp[1]);
      if (cnEp[2]) episodeEnd = parseChineseNumber(cnEp[2]);
    }
  }

  if (episode == null) {
    // Multi-episode range like "01-02" or "01-02连播"
    const rangeMatch = /(?:^|[^\p{L}\p{N}])0*(\d{1,4})\s*[-~+到至连播]\s*0*(\d{1,4})\s*(?:集|话|期)?(?=$|[^\p{L}\p{N}])/u.exec(text);
    if (rangeMatch) {
      episode = Number(rangeMatch[1]);
      episodeEnd = Number(rangeMatch[2]);
    }
  }

  if (episode == null) {
    // Trailing/standalone numeric label: "05", "第5", "05集", "05话"
    const standaloneNum = /(?:^|[^\p{L}\p{N}])0*(\d{1,4})\s*(?:集|话|期)?(?=$|[^\p{L}\p{N}])/u.exec(text);
    if (standaloneNum) {
      const candidateNum = Number(standaloneNum[1]);
      // Avoid parsing year (e.g. 2024) as episode number unless marked as episode
      if (candidateNum < 1900 || candidateNum > 2099 || /(?:集|话|期)/.test(standaloneNum[0])) {
        episode = candidateNum;
      }
    }
  }

  // 5. Clean Title extraction: strip noise words and brackets
  let clean = text;
  for (const tagPattern of NOISE_TAGS) {
    clean = clean.replace(tagPattern, ' ');
  }
  for (const wordPattern of NOISE_WORDS) {
    clean = clean.replace(wordPattern, ' ');
  }
  // Strip season and episode markers from clean title
  clean = clean
    .replace(/\bS(?:EASON)?\s*\d{1,2}\b/gi, ' ')
    .replace(/第\s*[0-9零〇一二三四五六七八九十百两兩]+\s*[季部]/gi, ' ')
    .replace(/\bE(?:P)?\s*\d{1,4}(?:\s*[-~+到至]\s*(?:E(?:P)?)?\s*\d{1,4})?\b/gi, ' ')
    .replace(/第\s*[0-9零〇一二三四五六七八九十百两兩]+\s*[集话話期回](?:\s*[-~+到至连播]\s*(?:第)?\s*[0-9零〇一二三四五六七八九十百两兩]+\s*[集话話期回]?)?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    raw: text,
    season,
    episode,
    episodeEnd,
    dateOrdinal,
    isSpecial,
    cleanTitle: clean,
  };
}

/**
 * Compares two episode names across scrapers to determine if they refer to the exact same episode.
 */
export function matchEpisodes(target: string, candidate: string): boolean {
  const a = normalizeEpisodeInfo(target);
  const b = normalizeEpisodeInfo(candidate);

  // Specials must not match regular episodes
  if (a.isSpecial !== b.isSpecial) return false;

  // Date ordinals for variety shows (e.g. 20240510)
  if (a.dateOrdinal && b.dateOrdinal) {
    return a.dateOrdinal === b.dateOrdinal;
  }

  // If both have season, season must match
  if (a.season != null && b.season != null && a.season !== b.season) {
    return false;
  }

  // If both have episode numbers, match them
  if (a.episode != null && b.episode != null) {
    if (a.episode === b.episode) return true;
    // Check range inclusion: e.g. candidate is "01-02", target is "01" or "02"
    if (a.episodeEnd != null && b.episode >= a.episode && b.episode <= a.episodeEnd) return true;
    if (b.episodeEnd != null && a.episode >= b.episode && a.episode <= b.episodeEnd) return true;
    return false;
  }

  // Fallback: if no numeric episode found, compare clean titles
  if (!a.episode && !b.episode && a.cleanTitle && b.cleanTitle) {
    const normA = a.cleanTitle.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    const normB = b.cleanTitle.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    return normA.length > 0 && normA === normB;
  }

  return false;
}

/**
 * Formats a clean, readable display label for an episode.
 */
export function formatEpisodeDisplay(info: NormalizedEpisodeInfo): string {
  if (info.isSpecial) {
    return info.episode != null ? `特别篇 EP${String(info.episode).padStart(2, '0')}` : '特别篇';
  }
  if (info.dateOrdinal) {
    return `${info.dateOrdinal.slice(0, 4)}-${info.dateOrdinal.slice(4, 6)}-${info.dateOrdinal.slice(6, 8)}期`;
  }
  if (info.episode != null) {
    const epStr = info.episodeEnd != null
      ? `第${info.episode}-${info.episodeEnd}集`
      : `第${info.episode}集`;
    if (info.cleanTitle) {
      return `${epStr} ${info.cleanTitle}`;
    }
    return epStr;
  }
  return info.cleanTitle || info.raw;
}
