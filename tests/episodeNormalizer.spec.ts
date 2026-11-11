import { describe, expect, it } from 'vitest';
import { formatEpisodeDisplay, matchEpisodes, normalizeEpisodeInfo } from '../src/shared/episodeNormalizer';

describe('episodeNormalizer (MoviePilot pattern)', () => {
  it('parses standard chinese episode labels', () => {
    const info = normalizeEpisodeInfo('第05集 决战紫禁之巅');
    expect(info.episode).toBe(5);
    expect(info.season).toBeNull();
    expect(info.isSpecial).toBe(false);
    expect(info.cleanTitle).toBe('决战紫禁之巅');
  });

  it('strips technical noise words, brackets, and resolutions', () => {
    const info = normalizeEpisodeInfo('[4K超清] 庆余年.S02E05.2024.HDR10+.H265.杜比音效.mp4');
    expect(info.season).toBe(2);
    expect(info.episode).toBe(5);
    expect(info.isSpecial).toBe(false);
  });

  it('parses multi-episode ranges', () => {
    const info = normalizeEpisodeInfo('EP05-06连播 [1080P]');
    expect(info.episode).toBe(5);
    expect(info.episodeEnd).toBe(6);
  });

  it('parses variety show date formats', () => {
    const info1 = normalizeEpisodeInfo('歌手2024 2024-05-10期');
    expect(info1.dateOrdinal).toBe('20240510');

    const info2 = normalizeEpisodeInfo('奔跑吧 20240510');
    expect(info2.dateOrdinal).toBe('20240510');

    expect(matchEpisodes('歌手2024 2024-05-10期', '奔跑吧 20240510')).toBe(true);
  });

  it('parses special episodes and OVAs correctly', () => {
    const info = normalizeEpisodeInfo('SP01 特别篇 番外');
    expect(info.isSpecial).toBe(true);
    expect(info.episode).toBe(1);

    // Specials must not match regular episode 1
    expect(matchEpisodes('SP01', '第01集')).toBe(false);
    expect(matchEpisodes('SP01', '特别篇01')).toBe(true);
  });

  it('matches episodes across different scrapers accurately', () => {
    // Scraper A: "第5集 决战" vs Scraper B: "EP05 [4K UHD]"
    expect(matchEpisodes('第5集 决战', 'EP05 [4K UHD]')).toBe(true);

    // Scraper A: "05" vs Scraper B: "第05集"
    expect(matchEpisodes('05', '第05集')).toBe(true);

    // Range inclusion: "EP05-06连播" matches target "第5集" or "第6集"
    expect(matchEpisodes('第5集', 'EP05-06连播')).toBe(true);
    expect(matchEpisodes('第6集', 'EP05-06连播')).toBe(true);
    expect(matchEpisodes('第7集', 'EP05-06连播')).toBe(false);

    // Season mismatch prevents accidental failover
    expect(matchEpisodes('S01E05', 'S02E05')).toBe(false);
    expect(matchEpisodes('第1季 第5集', 'S01E05')).toBe(true);
  });

  it('formats clean episode display strings', () => {
    const info1 = normalizeEpisodeInfo('第05集 决战紫禁之巅 [4K]');
    expect(formatEpisodeDisplay(info1)).toBe('第5集 决战紫禁之巅');

    const info2 = normalizeEpisodeInfo('EP01-02连播');
    expect(formatEpisodeDisplay(info2)).toBe('第1-2集');

    const info3 = normalizeEpisodeInfo('2024-05-10期');
    expect(formatEpisodeDisplay(info3)).toBe('2024-05-10期');
  });
});
