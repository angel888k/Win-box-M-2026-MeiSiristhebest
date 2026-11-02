import type { AggVodItem } from '../../../../shared/types';

export interface SearchResultWorkGroup {
  key: string;
  items: AggVodItem[];
  grouped: boolean;
}

/**
 * Deliberately conservative work grouping for the search view.
 * Raw reports remain untouched; only exact normalized titles with compatible
 * release years are collapsed, and each source/variant remains selectable.
 */
export function groupSearchResultsByExactWork(
  items: readonly AggVodItem[],
  defaultProfileId = '',
): SearchResultWorkGroup[] {
  const buckets = new Map<string, Array<{ item: AggVodItem; index: number }>>();
  const standalone: SearchResultWorkGroup[] = [];

  items.forEach((item, index) => {
    const title = normalizeExactWorkTitle(item.name);
    if (!title) {
      standalone.push({ key: `item:${index}`, items: [item], grouped: false });
      return;
    }
    const year = releaseYear(item);
    const identity = `${title}\u0000${year}`;
    const bucket = buckets.get(identity) ?? [];
    bucket.push({ item, index });
    buckets.set(identity, bucket);
  });

  const groups = new Map<number, SearchResultWorkGroup>();
  for (const [identity, bucket] of buckets) {
    const sourceIdentities = bucket.map(({ item }) => sourceIdentity(item, defaultProfileId));
    const hasRepeatedSource = new Set(sourceIdentities).size !== sourceIdentities.length;
    const hasKnownYear = !identity.endsWith('\u0000unknown');
    // A duplicate from one source may be a distinct cut, season, or edition.
    // Without stronger metadata, keep the whole title bucket in row view.
    const safeToGroup = bucket.length > 1 && hasKnownYear && !hasRepeatedSource;
    if (safeToGroup) {
      const first = bucket[0];
      groups.set(first.index, { key: `work:${identity}`, items: bucket.map(entry => entry.item), grouped: true });
    } else {
      for (const entry of bucket) groups.set(entry.index, { key: `item:${entry.index}`, items: [entry.item], grouped: false });
    }
  }

  const all = [...standalone, ...groups.values()];
  const order = new Map<AggVodItem, number>();
  items.forEach((item, index) => { if (!order.has(item)) order.set(item, index); });
  return all.sort((left, right) => (order.get(left.items[0]) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.items[0]) ?? Number.MAX_SAFE_INTEGER));
}

function sourceIdentity(item: AggVodItem, defaultProfileId: string): string {
  const profileId = String(item.sourceRef?.profileId || defaultProfileId || '');
  const sourceKey = String(item.sourceRef?.key || item.sourceKey || item.sourceName || '');
  return `${profileId}\u0000${sourceKey}`;
}

function normalizeExactWorkTitle(value: string): string {
  return String(value || '')
    .normalize('NFKC')
    .trim()
    .replace(/[\s._-]+(?:2160p|1440p|1080p|720p|480p|4k|uhd|hdr10?|web-dl|web-rip|blu-ray|bd|hd)(?:\s.*)?$/i, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function releaseYear(item: AggVodItem): string {
  const metadataYear = String(item.year || '').match(/(?:19|20)\d{2}/)?.[0];
  const titleYear = item.name.match(/(?:^|\D)((?:19|20)\d{2})(?:年)?(?=\D|$)/)?.[1];
  return metadataYear || titleYear || 'unknown';
}
