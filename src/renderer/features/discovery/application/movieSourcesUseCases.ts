import { mergeSearchResults, SearchResultsAccumulator } from '../../../../engine/vod/aggSearch';
import type { SearchAllProgressEvent, SearchAllReport } from '../../../../shared/types';
import type {
  MovieSourceFolderIdentity,
  MovieSourceFolderPort,
  MovieSourcesSearchPort,
} from './movieSourcesPorts';

export interface MovieSourcesProgress {
  done: number;
  total: number;
}

export interface MovieSourcesProgressUpdate {
  report: SearchAllReport;
  progress: MovieSourcesProgress;
}

export interface MovieSourcesSearchResult {
  report: SearchAllReport;
  progress: MovieSourcesProgress | null;
}

export interface MovieSourcesSearchStreamOptions {
  /** Search this profile first while still including every configured profile. */
  priorityProfileId?: string;
  /** Deliver each completed source immediately without building a full report snapshot. */
  onSource?: (report: SearchAllReport, progress: MovieSourcesProgress) => void;
  /** Forward progress-only events without materializing a full aggregate report. */
  onSearchProgress?: (progress: MovieSourcesProgress) => void;
  /** Coalesce expensive aggregate snapshots for UI progress consumers. Defaults to 200 ms. */
  progressIntervalMs?: number;
}

function abortError(): Error {
  const error = new Error('搜索已取消');
  error.name = 'AbortError';
  return error;
}

/** Resolve the all-profile scope and stream only events belonging to this query/scope. */
export async function searchMovieSources(
  query: string,
  refresh: boolean,
  port: MovieSourcesSearchPort,
  onProgress?: (update: MovieSourcesProgressUpdate) => void,
  signal?: AbortSignal,
  streamOptions: MovieSourcesSearchStreamOptions = {},
): Promise<MovieSourcesSearchResult> {
  if (signal?.aborted) throw abortError();
  const scope = await port.readScope();
  if (signal?.aborted) throw abortError();

  const profileIds = [...new Set(scope.profileIds)];
  const priorityProfileId = streamOptions.priorityProfileId?.trim();
  const priorityIndex = priorityProfileId ? profileIds.indexOf(priorityProfileId) : -1;
  if (priorityProfileId && priorityIndex > 0) {
    profileIds.splice(priorityIndex, 1);
    profileIds.unshift(priorityProfileId);
  }
  if (!profileIds.length && !scope.hasConfiguredSources) {
    throw new Error('请先导入订阅，再搜索播放来源');
  }

  const acceptedProfiles = new Set(profileIds.length ? profileIds : [scope.activeProfileId]);
  const accumulator = new SearchResultsAccumulator();
  let latestProgress: MovieSourcesProgress | null = null;
  let unsubscribe: () => void = () => {};
  let disposed = false;
  let progressTimer: ReturnType<typeof setTimeout> | undefined;
  const progressIntervalMs = Math.max(50, streamOptions.progressIntervalMs ?? 200);
  const publishProgress = (): void => {
    progressTimer = undefined;
    if (disposed || !latestProgress || !onProgress) return;
    onProgress({ report: accumulator.snapshot(), progress: latestProgress });
  };
  const dispose = () => {
    if (disposed) return;
    if (progressTimer) {
      clearTimeout(progressTimer);
      publishProgress();
    }
    disposed = true;
    progressTimer = undefined;
    unsubscribe();
  };
  const onAbort = () => dispose();

  unsubscribe = port.onProgress((event: SearchAllProgressEvent) => {
    if (disposed || event.wd !== query || !acceptedProfiles.has(event.profileId ?? '')) return;
    if (event.source && onProgress) {
      accumulator.add(event.source, { profileOrder: event.profileOrder, sourceOrder: event.sourceOrder });
    }
    latestProgress = { done: event.done, total: event.total };
    if (event.source && streamOptions.onSource) {
      streamOptions.onSource(mergeSearchResults([event.source]), latestProgress);
    } else if (!event.source) {
      streamOptions.onSearchProgress?.(latestProgress);
    }
    if (onProgress && !progressTimer) {
      progressTimer = setTimeout(publishProgress, progressIntervalMs);
    }
  });
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const options = profileIds.length
      ? { profileIds, refresh }
      : { profileId: scope.activeProfileId, refresh };
    const report = await port.searchAll(query, options, signal);
    return { report, progress: latestProgress };
  } finally {
    signal?.removeEventListener('abort', onAbort);
    dispose();
  }
}

/** Expand a cloud-drive folder while preserving the exact profile/source identity used to find it. */
export async function loadMovieSourceFolder(
  port: MovieSourceFolderPort,
  source: MovieSourceFolderIdentity,
) {
  const result = await port.category({
    key: source.sourceKey,
    tid: source.id,
    pg: '1',
    extend: {},
    profileId: source.sourceRef?.profileId,
  });

  return result.items.map(item => ({
    ...item,
    sourceKey: source.sourceKey,
    sourceRef: source.sourceRef,
    sourceName: source.sourceName,
    sourceProfileName: source.sourceProfileName,
    sameFromOtherSources: 0,
  }));
}
