// @vitest-environment happy-dom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AggVodItem } from '../src/shared/types';
import type { HomeSearchResultsModel } from '../src/renderer/features/home/homePageViewModel';
import { HomeSearchResultsView } from '../src/renderer/features/home/HomeSearchResultsView';

function item(id: string, sourceKey: string, sourceName: string): AggVodItem {
  return {
    id, name: '《繁花》 4K', pic: '', remarks: '', year: '2023', area: '', type: '剧情',
    sourceKey, sourceName, sourceRef: { profileId: 'profile-a', key: sourceKey }, sameFromOtherSources: 0,
  };
}

describe('HomeSearchResultsView cross-source grouping', () => {
  it('keeps raw results available and lets the user choose a source inside a grouped work card', () => {
    const a = item('a', 'source-a', '来源 A');
    const b = item('b', 'source-b', '来源 B');
    const onOpenItem = vi.fn();
    const model = {
      report: { items: [a, b], perSource: [], hitSources: 2, failedSources: 0, totalRaw: 2 },
      view: { items: [a, b], profiles: [], sources: [], hiddenCount: 0 },
      folder: null,
      loading: false,
      scope: 'all',
      defaultProfileId: 'profile-a',
      progress: null,
      query: '繁花',
      sourceFilter: '',
      profileFilter: '',
      matchMode: 'related',
      groupByWork: true,
      visibleLimit: 20,
      picOf: () => '',
      onImageError: () => undefined,
      onOpenItem,
      onRetry: () => undefined,
      onProfileFilter: () => undefined,
      onSourceFilter: () => undefined,
      onMatchMode: () => undefined,
      onGroupByWork: vi.fn(),
      onShowMore: () => undefined,
    } as HomeSearchResultsModel;

    const { rerender } = render(<HomeSearchResultsView {...model} />);
    expect(document.querySelectorAll('.search-result-grid .card-media')).toHaveLength(1);
    expect(screen.getByText('选择播放版本 · 2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '逐条显示' }));
    expect(model.onGroupByWork).toHaveBeenCalledWith(false);
    rerender(<HomeSearchResultsView {...model} groupByWork={false} />);
    expect(document.querySelectorAll('.search-result-grid .card-media')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: '同名跨源聚合' }));
    expect(model.onGroupByWork).toHaveBeenCalledWith(true);
    rerender(<HomeSearchResultsView {...model} groupByWork={true} />);
    expect(document.querySelectorAll('.search-result-grid .card-media')).toHaveLength(1);
    fireEvent.click(screen.getByText('选择播放版本 · 2'));
    fireEvent.click(screen.getByRole('button', { name: /来源 B/ }));

    expect(onOpenItem).toHaveBeenCalledWith(b);
    expect(screen.getByRole('button', { name: '逐条显示' }).getAttribute('aria-pressed')).toBe('false');
  });
});
