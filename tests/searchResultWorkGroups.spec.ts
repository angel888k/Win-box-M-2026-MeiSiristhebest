import { describe, expect, it } from 'vitest';
import type { AggVodItem } from '../src/shared/types';
import { groupSearchResultsByExactWork } from '../src/renderer/features/search/application/searchResultWorkGroups';

function item(id: string, name: string, source: string, year = '2023', profile = 'profile-a'): AggVodItem {
  return {
    id, name, pic: '', remarks: '', year, area: '', type: '剧情',
    sourceKey: source, sourceName: source,
    sourceRef: { profileId: profile, key: source },
    sameFromOtherSources: 0,
  };
}

describe('optional exact cross-source work grouping', () => {
  it('groups punctuation and trailing quality variants only when the year agrees', () => {
    const groups = groupSearchResultsByExactWork([
      item('a', '《繁花》 4K', 'source-a'),
      item('b', '繁花 1080P', 'source-b'),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ grouped: true, items: [{ id: 'a' }, { id: 'b' }] });
  });

  it('keeps remakes and differently cut editions separate', () => {
    const groups = groupSearchResultsByExactWork([
      item('a', '繁花 2023', 'source-a', '2023'),
      item('b', '繁花 2024', 'source-b', '2024'),
      item('c', '繁花 导演剪辑版 4K', 'source-c', '2023'),
    ]);

    expect(groups).toHaveLength(3);
    expect(groups.every(group => !group.grouped)).toBe(true);
  });

  it('keeps repeated same-source entries separate even when another source matches', () => {
    const groups = groupSearchResultsByExactWork([
      item('a1', '流浪地球', 'source-a'),
      item('a2', '流浪地球', 'source-a'),
      item('b', '流浪地球', 'source-b'),
    ]);

    expect(groups.map(group => group.items[0].id)).toEqual(['a1', 'a2', 'b']);
    expect(groups.every(group => !group.grouped && group.items.length === 1)).toBe(true);
  });

  it('does not merge cross-source same-title results when the year is unknown', () => {
    const groups = groupSearchResultsByExactWork([
      item('a', '同名作品', 'source-a', ''),
      item('b', '同名作品', 'source-b', ''),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.every(group => !group.grouped)).toBe(true);
  });

  it('treats the same source key in separate profiles as distinct source results', () => {
    const groups = groupSearchResultsByExactWork([
      item('a', '跨档案作品', 'source-a', '2023', 'profile-a'),
      item('b', '跨档案作品', 'source-a', '2023', 'profile-b'),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ grouped: true, items: [{ id: 'a' }, { id: 'b' }] });
  });

  it('separates unknown year from a known year and keeps first-seen order', () => {
    const groups = groupSearchResultsByExactWork([
      item('first', '片名', 'source-a', ''),
      item('second', '另一个片', 'source-b', ''),
      item('third', '片名', 'source-c', '2020'),
    ]);

    expect(groups.map(group => group.items[0].id)).toEqual(['first', 'second', 'third']);
    expect(groups.every(group => !group.grouped)).toBe(true);
  });
});
