import { describe, expect, it } from 'vitest';
import { matchPlaybackEpisode, samePlaybackTitle } from '../src/renderer/features/playback/application/playbackSourceMatching';

describe('playback source identity matching', () => {
  it('accepts punctuation and release metadata while retaining year and season identity', () => {
    expect(samePlaybackTitle('《繁花》 (2023) 4K', '繁花 2023')).toBe(true);
    expect(samePlaybackTitle('流浪地球', '流浪地球2')).toBe(false);
    expect(samePlaybackTitle('庆余年 第二季', '庆余年 第2季')).toBe(true);
    expect(samePlaybackTitle('庆余年 第二季', '庆余年 第一季')).toBe(false);
    expect(samePlaybackTitle('繁花 2023', '繁花 2024')).toBe(false);
  });

  it('matches an explicit season and episode across Chinese and S01E01 labels', () => {
    expect(matchPlaybackEpisode('第1季第十二集', {
      '高清': [{ name: 'S01E12.1080p.mkv', url: 'episode-12' }],
    })).toEqual({
      kind: 'unique',
      match: { flag: '高清', index: 0, episode: { name: 'S01E12.1080p.mkv', url: 'episode-12' } },
    });
  });

  it('recognizes common season-episode spellings without crossing seasons', () => {
    for (const selected of ['Season 2 Episode 03', '2x03', '第2季第3集']) {
      expect(matchPlaybackEpisode(selected, {
        '线路': [{ name: 'S02E03.mkv', url: 'right-season' }],
      })).toMatchObject({ kind: 'unique', match: { index: 0 } });
      expect(matchPlaybackEpisode(selected, {
        '线路': [{ name: 'S01E03.mkv', url: 'wrong-season' }],
      })).toEqual({ kind: 'none' });
    }
  });

  it('does not treat the same list index as proof of the same episode', () => {
    expect(matchPlaybackEpisode('第03集', {
      '高清': [
        { name: '第01集', url: 'episode-1' },
        { name: '第02集', url: 'episode-2' },
        { name: '番外篇', url: 'special' },
      ],
    })).toEqual({ kind: 'none' });
  });

  it('treats duplicate matches across play flags as alternate routes to the same episode', () => {
    expect(matchPlaybackEpisode('第01集', {
      '国语': [{ name: '第01集', url: 'episode-1-zh' }],
      '粤语': [{ name: '第01集', url: 'episode-1-yue' }],
    })).toMatchObject({ kind: 'unique', match: { flag: '国语', index: 0 } });
  });

  it('prefers the best quality flag while still rejecting duplicate cuts in one flag', () => {
    expect(matchPlaybackEpisode('第01集', {
      '720P': [{ name: '第01集', url: '720' }],
      '4K': [{ name: '第01集', url: '4k' }],
    })).toMatchObject({ kind: 'unique', match: { flag: '4K', index: 0 } });
    expect(matchPlaybackEpisode('第01集', {
      '线路A': [{ name: '第01集', url: 'cut-a' }, { name: '第01集', url: 'cut-b' }],
    })).toEqual({ kind: 'ambiguous', count: 2 });
    expect(matchPlaybackEpisode('第01集', {
      '线路': [
        { name: '第01集 720P', url: '720' },
        { name: '第01集 4K', url: '4k' },
      ],
    })).toEqual({ kind: 'ambiguous', count: 2 });
    expect(matchPlaybackEpisode('第01集', {
      '普通线路': [{ name: '第01集 720P', url: '720' }],
      '备用线路': [{ name: '第01集 4K', url: '4k' }],
    })).toMatchObject({ kind: 'unique', match: { flag: '备用线路', index: 0 } });
  });

  it('keeps season with episode identity and matches equivalent movie editions', () => {
    expect(matchPlaybackEpisode('S01E02', {
      '线路': [{ name: 'S02E02', url: 'wrong-season' }],
    })).toEqual({ kind: 'none' });
    expect(matchPlaybackEpisode('S01E02', {
      '线路': [{ name: '第02集', url: 'season-not-provided' }],
    })).toEqual({ kind: 'none' });
    expect(matchPlaybackEpisode('第02集', {
      '线路': [{ name: 'S01E02', url: 'season-not-provided-on-current-source' }],
    })).toEqual({ kind: 'none' });
    expect(matchPlaybackEpisode('HD', {
      '线路': [{ name: '正片', url: 'feature' }],
    })).toMatchObject({ kind: 'unique', match: { index: 0 } });
    expect(matchPlaybackEpisode('HD', {
      '线路': [{ name: '预告片', url: 'trailer' }],
    })).toEqual({ kind: 'none' });
  });

  it('uses an exact label only when the selected episode has no explicit ordinal', () => {
    expect(matchPlaybackEpisode('预告片', {
      '正片': [{ name: '预告片', url: 'trailer' }],
    })).toMatchObject({ kind: 'unique', match: { flag: '正片', index: 0 } });
    expect(matchPlaybackEpisode('未知集名', {
      '正片': [{ name: '不同集名', url: 'episode' }],
    })).toEqual({ kind: 'none' });
  });
});
