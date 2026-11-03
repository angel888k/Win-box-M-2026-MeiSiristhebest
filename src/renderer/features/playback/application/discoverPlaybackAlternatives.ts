import type { AggVodItem, SearchAllReport, VodDetail } from '../../../../shared/types';
import type { PlayerInitData } from './playerPageSession';
import { matchPlaybackEpisode, playbackTitleYear, samePlaybackTitle } from './playbackSourceMatching';

export interface PlaybackAlternativeCandidate {
  id: string;
  sourceName: string;
  profileName: string;
  data: PlayerInitData;
}

export interface PlaybackAlternativeSearchResult {
  candidates: PlaybackAlternativeCandidate[];
  incompleteSources: number;
  searchIncomplete?: boolean;
  truncated: boolean;
}

export interface PlaybackAlternativeSearchPort {
  search(query: string, signal: AbortSignal, onReport: (report: SearchAllReport) => void, refresh?: boolean): Promise<SearchAllReport>;
  loadDetail(input: { key: string; id: string; profileId: string }, signal?: AbortSignal): Promise<VodDetail | null>;
}

export interface DiscoverPlaybackAlternativesInput {
  current: PlayerInitData;
  episodeIndex: number;
  position: number;
  excludedSourceIds: ReadonlySet<string>;
  refresh?: boolean;
}

const MAX_DETAIL_LOOKUPS = 24;
const DETAIL_LOOKUP_CONCURRENCY = 8;
const SEARCH_DEADLINE_MS = 45_000;
const DETAIL_DEADLINE_MS = 10_000;
const DISCOVERY_DEADLINE_MS = 60_000;

/** Search all configured profiles, then verify title/year/episode against each source's detail. */
export async function discoverPlaybackAlternatives(
  input: DiscoverPlaybackAlternativesInput,
  port: PlaybackAlternativeSearchPort,
  signal: AbortSignal,
  onCandidate?: (candidate: PlaybackAlternativeCandidate) => void,
): Promise<PlaybackAlternativeSearchResult> {
  if (signal.aborted) throw abortError();
  const deadlineAt = Date.now() + DISCOVERY_DEADLINE_MS;
  const remainingBudget = (): number => Math.max(0, deadlineAt - Date.now());
  const selectedEpisode = input.current.episodes[input.episodeIndex];
  const currentKey = input.current.meta?.fromKey || input.current.key;
  const currentProfileId = input.current.meta?.profileId || '';

  // The player already has the selected title. Fetching its detail again before
  // starting aggregate search added up to 10 seconds to every recovery attempt.
  const title = input.current.title.trim();
  if (!title || !selectedEpisode?.name.trim()) return { candidates: [], incompleteSources: 0, searchIncomplete: false, truncated: false };

  const expectedYear = playbackTitleYear(title);
  const partialSources = new Map<string, SearchAllReport['perSource'][number]>();
  let partialPendingSources: number | undefined;
  let partialHitSources = 0;
  let partialFailedSources = 0;
  let partialTotalRaw = 0;
  const queuedItems = new Set<string>();
  const detailQueue: Array<[string, AggVodItem]> = [];
  const candidatesById = new Map<string, PlaybackAlternativeCandidate>();
  const rememberPartialReport = (partial: SearchAllReport): void => {
    partialHitSources = Math.max(partialHitSources, partial.hitSources);
    partialFailedSources = Math.max(partialFailedSources, partial.failedSources);
    partialTotalRaw = Math.max(partialTotalRaw, partial.totalRaw);
    if (partial.pendingSources !== undefined) partialPendingSources = partial.pendingSources;
    for (const source of partial.perSource) {
      partialSources.set(`${source.profileId || ''}\u001f${source.key}`, source);
    }
  };
  const partialReportSnapshot = (): SearchAllReport => {
    const perSource = [...partialSources.values()];
    const totalRaw = perSource.length
      ? perSource.reduce((sum, source) => sum + (source.count || 0), 0)
      : partialTotalRaw;
    return {
      // Partial source items were already verified as they streamed in. Keep
      // only summary data here so a long search does not retain a second copy.
      items: [],
      perSource,
      hitSources: perSource.length
        ? perSource.filter(source => source.status === 'ok' && (source.count || 0) > 0).length
        : partialHitSources,
      failedSources: Math.max(partialFailedSources, perSource.filter(source => source.status === 'error').length),
      totalRaw,
      ...(partialPendingSources !== undefined ? { pendingSources: partialPendingSources } : {}),
    };
  };
  let lookupCount = 0;
  let truncated = false;
  let failedDetailLookups = 0;
  let drainTask: Promise<void> | null = null;

  const verifyItem = async ([id, item]: [string, AggVodItem]): Promise<void> => {
    if (signal.aborted) return;
    const profileId = item.sourceRef!.profileId;
    const sourceKey = item.sourceRef!.key || item.sourceKey;
    let detail: VodDetail | null;
    try {
      const detailBudget = Math.min(DETAIL_DEADLINE_MS, remainingBudget());
      if (detailBudget <= 0) {
        failedDetailLookups += 1;
        return;
      }
      detail = await withDeadline(
        detailSignal => port.loadDetail({ key: sourceKey, id: item.id, profileId }, detailSignal),
        detailBudget,
        signal,
      );
    } catch {
      if (!signal.aborted) failedDetailLookups += 1;
      return;
    }
    if (signal.aborted) return;
    if (!detail?.name) {
      failedDetailLookups += 1;
      return;
    }
    if (!samePlaybackTitle(title, detail.name)) return;

    const targetYear = expectedYear;
    const candidateYear = parseYear(detail.year) ?? parseYear(item.year) ?? playbackTitleYear(detail.name);
    if (targetYear != null && candidateYear != null && candidateYear !== targetYear) return;

    const episodeMatch = matchPlaybackEpisode(selectedEpisode.name, detail.episodes || {});
    if (episodeMatch.kind !== 'unique') return;
    const episodes = detail.episodes[episodeMatch.match.flag];
    const episodeIndex = episodeMatch.match.index;
    if (!episodes?.[episodeIndex]) return;

    const sourceName = item.sourceName || item.sourceKey;
    const displayTitle = detail.name.trim();
    const data: PlayerInitData = {
      key: sourceKey,
      flag: episodeMatch.match.flag,
      episodes,
      epIndex: episodeIndex,
      title: displayTitle,
      subtitleTitle: input.current.subtitleTitle,
      lastUrl: '',
      lastName: displayTitle,
      startTime: Math.max(0, input.position),
      deferHistoryUntilPlayback: true,
      meta: {
        pic: detail.pic || item.pic,
        remarks: item.remarks || detail.remarks,
        sourceName,
        vodId: item.id,
        fromKey: sourceKey,
        id: item.id,
        profileId,
      },
    };
    const candidate: PlaybackAlternativeCandidate = {
      id,
      sourceName,
      profileName: item.sourceProfileName || '',
      data,
    };
    if (!candidatesById.has(id)) {
      candidatesById.set(id, candidate);
      onCandidate?.(candidate);
    }
  };

  const drainDetails = (): Promise<void> => {
    if (drainTask) return drainTask;
    drainTask = (async () => {
      while (detailQueue.length > 0 && !signal.aborted) {
        if (remainingBudget() <= 0) {
          failedDetailLookups += detailQueue.length;
          detailQueue.length = 0;
          break;
        }
        const batch = detailQueue.splice(0, DETAIL_LOOKUP_CONCURRENCY);
        await Promise.all(batch.map(verifyItem));
      }
    })().finally(() => { drainTask = null; });
    return drainTask;
  };

  const enqueueReport = (partial: SearchAllReport): void => {
    if (signal.aborted) return;
    rememberPartialReport(partial);
    for (const item of partial.items) {
      const profileId = item.sourceRef?.profileId;
      const sourceKey = item.sourceRef?.key || item.sourceKey;
      if (!profileId || !sourceKey || !item.id || item.tag === 'folder') continue;
      if (!samePlaybackTitle(title, item.name)) continue;
      const itemYear = parseYear(item.year) ?? playbackTitleYear(item.name);
      if (expectedYear != null && itemYear != null && itemYear !== expectedYear) continue;
      if (profileId === currentProfileId && sourceKey === currentKey) continue;
      const id = sourceIdentity(profileId, sourceKey, item.id);
      if (input.excludedSourceIds.has(id) || queuedItems.has(id)) continue;
      queuedItems.add(id);
      if (lookupCount >= MAX_DETAIL_LOOKUPS) {
        truncated = true;
        continue;
      }
      lookupCount += 1;
      detailQueue.push([id, item]);
    }
    if (detailQueue.length > 0) void drainDetails();
  };

  let report: SearchAllReport;
  let searchIncomplete = false;
  try {
    const searchBudget = Math.min(SEARCH_DEADLINE_MS, remainingBudget());
    if (searchBudget <= 0) throw new PlaybackDeadlineError();
    report = await withDeadline(
      searchSignal => port.search(title, searchSignal, enqueueReport, input.refresh === true),
      searchBudget,
      signal,
    );
  } catch (error) {
    if (signal.aborted) throw abortError();
    if (!(error instanceof PlaybackDeadlineError)) throw error;
    // Keep verified partial results when the aggregate scan exceeds its budget.
    // The partial scan is explicitly marked so it cannot be presented as “no source exists”.
    report = partialReportSnapshot();
    searchIncomplete = true;
  }
  enqueueReport(report);
  while (drainTask || detailQueue.length > 0) {
    if (drainTask) await drainTask;
    else await drainDetails();
  }
  if (signal.aborted) throw abortError();

  return {
    candidates: [...candidatesById.values()],
    // Any failed or still-pending source might contain another exact match. A
    // single verified candidate is not safe to auto-select in that case.
    incompleteSources: Math.max(0, (report.pendingSources || 0) + (report.failedSources || 0) + failedDetailLookups),
    searchIncomplete,
    truncated,
  };
}

export function sourceIdentity(profileId: string, sourceKey: string, vodId: string): string {
  return `${profileId}\u001f${sourceKey}\u001f${vodId}`;
}

function parseYear(value: string | number | undefined): number | null {
  const match = String(value ?? '').match(/(?:19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

function withDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  parentSignal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (parentSignal.aborted) {
      reject(abortError());
      return;
    }
    if (timeoutMs <= 0) {
      reject(new PlaybackDeadlineError());
      return;
    }
    const controller = new AbortController();
    let settled = false;
    const timer = setTimeout(() => {
      controller.abort();
      finish(() => reject(new PlaybackDeadlineError()));
    }, timeoutMs);
    const onAbort = () => {
      controller.abort();
      finish(() => reject(abortError()));
    };
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      parentSignal.removeEventListener('abort', onAbort);
      complete();
    };
    parentSignal.addEventListener('abort', onAbort, { once: true });
    let promise: Promise<T>;
    try {
      promise = operation(controller.signal);
    } catch (error) {
      finish(() => reject(error));
      return;
    }
    promise.then(
      value => finish(() => resolve(value)),
      error => finish(() => reject(error)),
    );
  });
}

class PlaybackDeadlineError extends Error {
  constructor() {
    super('备用源搜索超时');
    this.name = 'TimeoutError';
  }
}

function abortError(): Error {
  const error = new Error('备用源搜索已取消');
  error.name = 'AbortError';
  return error;
}
