import { normalizeEpisodeInfo } from '../../../../shared/episodeNormalizer';
import { movieSearchTitle } from '../../../../shared/searchTitleMatching';
import type { Episode } from '../../../../shared/types';

export interface EpisodeSourceMatch {
  flag: string;
  index: number;
  episode: Episode;
}

export type EpisodeSourceMatchResult =
  | { kind: 'unique'; match: EpisodeSourceMatch }
  | { kind: 'none' }
  | { kind: 'ambiguous'; count: number };

interface TitleIdentity {
  key: string;
  season: number | null;
  year: number | null;
}

const seasonPattern = /(?:第\s*([零〇一二三四五六七八九十百两兩\d]+)\s*[季部]|\bS(?:EASON)?\s*0*(\d{1,2})\b)/i;
const yearPattern = /(?:^|\D)((?:19|20)\d{2})(?:年)?(?=\D|$)/;
const punctuation = /[^\p{L}\p{N}]+/gu;

/**
 * Conservative identity comparison for automatic source changes.
 * Unlike searchTitleScore, this function does not accept prefixes, pinyin,
 * descriptions, or merely related titles.
 */
export function samePlaybackTitle(left: string, right: string): boolean {
  const a = titleIdentity(left);
  const b = titleIdentity(right);
  if (!a.key || a.key.length < 2 || a.key !== b.key || a.season !== b.season) return false;
  // Some sources omit release year in search/detail metadata. Missing metadata
  // is not evidence of a different title; a known year conflict still is.
  return a.year == null || b.year == null || a.year === b.year;
}

export function playbackTitleYear(value: string): number | null {
  return titleIdentity(value).year;
}

/** Never uses the source list index as evidence that two episodes are equal. */
export function matchPlaybackEpisode(
  selectedName: string,
  candidateEpisodes: Record<string, Episode[]>,
): EpisodeSourceMatchResult {
  const selectedOrdinal = episodeOrdinal(selectedName);
  const selectedInfo = normalizeEpisodeInfo(selectedName);
  const selectedLabel = normalizeEpisodeLabel(selectedName);
  const selectedMovieKind = movieEditionKind(selectedName);
  if (selectedOrdinal == null && !selectedLabel && !selectedMovieKind && !selectedInfo.dateOrdinal) return { kind: 'none' };

  const matches: EpisodeSourceMatch[] = [];
  for (const [flag, episodes] of Object.entries(candidateEpisodes)) {
    episodes.forEach((episode, index) => {
      const candidateOrdinal = episodeOrdinal(episode.name);
      const candidateInfo = normalizeEpisodeInfo(episode.name);
      const matchesOrdinal = selectedOrdinal != null && candidateOrdinal != null
        && candidateOrdinal.episode === selectedOrdinal.episode
        // A missing season is unknown, not a wildcard. Treat it as a match only
        // when both sources omit season; otherwise auto-failover could cross seasons.
        && selectedOrdinal.season === candidateOrdinal.season;
      const matchesDate = selectedInfo.dateOrdinal != null && candidateInfo.dateOrdinal != null
        && selectedInfo.dateOrdinal === candidateInfo.dateOrdinal;
      const matchesMovieEdition = selectedOrdinal == null && selectedInfo.dateOrdinal == null && selectedMovieKind != null
        && movieEditionKind(episode.name) === selectedMovieKind;
      const matchesExactLabel = selectedOrdinal == null && selectedInfo.dateOrdinal == null && selectedMovieKind == null
        && normalizeEpisodeLabel(episode.name) === selectedLabel;
      if (matchesOrdinal || matchesDate || matchesMovieEdition || matchesExactLabel) matches.push({ flag, index, episode });
    });
  }

  if (matches.length === 0) return { kind: 'none' };
  if (selectedOrdinal?.season == null) {
    const explicitSeasons = new Set(matches
      .map(match => episodeOrdinal(match.episode.name)?.season)
      .filter((season): season is number => season != null));
    if (explicitSeasons.size > 1) return { kind: 'ambiguous', count: matches.length };
  }
  // Multiple flags often describe alternate routes (audio/quality) to the same
  // episode. They are not ambiguous. Duplicate matching entries within one
  // flag still need a human choice because they may be different cuts.
  const matchesByFlag = new Map<string, EpisodeSourceMatch[]>();
  for (const match of matches) {
    const routes = matchesByFlag.get(match.flag) || [];
    routes.push(match);
    matchesByFlag.set(match.flag, routes);
  }
  const duplicateEpisodes = [...matchesByFlag.values()].filter(routes => routes.length > 1).flat();
  if (duplicateEpisodes.length > 0) return { kind: 'ambiguous', count: duplicateEpisodes.length };
  const preferred = [...matches].sort((left, right) => (
    playbackQualityScore(right.flag, right.episode.name) - playbackQualityScore(left.flag, left.episode.name)
  ));
  return { kind: 'unique', match: preferred[0] };
}

function titleIdentity(raw: string): TitleIdentity {
  const source = (raw || '').normalize('NFKC').trim();
  const seasonMatch = seasonPattern.exec(source);
  const season = seasonMatch
    ? seasonMatch[1] ? parseChineseNumber(seasonMatch[1]) : Number(seasonMatch[2])
    : null;
  const yearMatch = yearPattern.exec(source);
  const parsedYear = yearMatch ? Number(yearMatch[1]) : null;
  const year = parsedYear && /\p{L}|\p{N}/u.test(source.replace(yearMatch?.[0] || '', '')) ? parsedYear : null;

  let title = movieSearchTitle(source).normalize('NFKC');
  title = title.replace(/[\s._-]+(?:2160p|1440p|1080p|720p|480p|4k|uhd|hdr10?|web-dl|web-rip|blu-ray|bd|hd)(?:[\s._-].*)?$/i, ' ');
  if (seasonMatch) title = title.replace(seasonMatch[0], ' ');
  if (year) title = title.replace(new RegExp(`(?:19|20)${String(year).slice(2)}年?`, 'g'), ' ');
  return {
    key: title.toLocaleLowerCase().replace(punctuation, ''),
    season: Number.isFinite(season) ? season : null,
    year,
  };
}

interface EpisodeOrdinal {
  season: number | null;
  episode: number;
}

function episodeOrdinal(value: string): EpisodeOrdinal | null {
  const normalized = (value || '').normalize('NFKC').trim();
  const seasonEpisode = /\bS\s*\d{1,2}\s*E\s*0*(\d{1,4})\b/i.exec(normalized);
  if (seasonEpisode) {
    const season = /\bS\s*0*(\d{1,2})\s*E/i.exec(normalized);
    return { season: season ? Number(season[1]) : null, episode: Number(seasonEpisode[1]) };
  }

  const englishSeasonEpisode = /\bSEASON\s*0*(\d{1,2})\s+(?:EP?ISODE|EP)\s*0*(\d{1,4})\b/i.exec(normalized);
  if (englishSeasonEpisode) return { season: Number(englishSeasonEpisode[1]), episode: Number(englishSeasonEpisode[2]) };

  const compactSeasonEpisode = /(?:^|[^\p{L}\p{N}])0*(\d{1,2})\s*[xX]\s*0*(\d{1,4})(?=$|[^\p{L}\p{N}])/u.exec(normalized);
  if (compactSeasonEpisode) return { season: Number(compactSeasonEpisode[1]), episode: Number(compactSeasonEpisode[2]) };

  const chineseSeasonEpisode = /第\s*([零〇一二三四五六七八九十百两兩\d]+)\s*季.*?第\s*([零〇一二三四五六七八九十百两兩\d]+)\s*[集话話回]/i.exec(normalized);
  if (chineseSeasonEpisode) {
    const season = parseChineseNumber(chineseSeasonEpisode[1]);
    const episode = parseChineseNumber(chineseSeasonEpisode[2]);
    return episode == null ? null : { season, episode };
  }

  const chinese = /第\s*([零〇一二三四五六七八九十百两兩\d]+)\s*[集话話回]/i.exec(normalized);
  if (chinese) {
    const episode = parseChineseNumber(chinese[1]);
    return episode == null ? null : { season: null, episode };
  }

  const ep = /(?:^|[^\p{L}\p{N}])(?:EP?|EPISODE)\s*0*(\d{1,4})(?=$|[^\p{L}\p{N}])/iu.exec(normalized);
  if (ep) return { season: null, episode: Number(ep[1]) };

  const numericLabel = /^0*(\d{1,4})$/.exec(normalized);
  return numericLabel ? { season: null, episode: Number(numericLabel[1]) } : null;
}

function movieEditionKind(value: string): 'feature' | null {
  const normalized = (value || '').normalize('NFKC').toLocaleLowerCase();
  if (/预告|花絮|幕后|片段|彩蛋|解说/.test(normalized)) return null;
  return /正片|电影|(?:^|[^\p{L}\p{N}])(?:hd|uhd|4k|2160p|1080p|720p|超清|高清)(?:$|[^\p{L}\p{N}])/iu.test(normalized)
    ? 'feature'
    : null;
}

function flagQualityScore(flag: string): number {
  const normalized = flag.normalize('NFKC').toLocaleLowerCase();
  if (/2160p|4k|uhd/.test(normalized)) return 40;
  if (/1080p|fhd/.test(normalized)) return 30;
  if (/720p|hd/.test(normalized)) return 20;
  if (/480p|sd/.test(normalized)) return 10;
  return 0;
}

function playbackQualityScore(flag: string, episodeName: string): number {
  return flagQualityScore(`${flag} ${episodeName}`);
}

function normalizeEpisodeLabel(value: string): string {
  return (value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\.(?:mkv|mp4|ts|m2ts|avi|rmvb|flv|mov|wmv|webm)$/i, '')
    .replace(punctuation, '');
}

function parseChineseNumber(value: string): number | null {
  if (/^\d+$/.test(value)) return Number(value);
  const digits: Record<string, number> = {
    零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 兩: 2, 三: 3, 四: 4, 五: 5,
    六: 6, 七: 7, 八: 8, 九: 9,
  };
  let total = 0;
  let current = 0;
  for (const char of value) {
    if (char in digits) {
      current = digits[char];
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
