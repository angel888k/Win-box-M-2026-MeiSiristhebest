import { formatEpisodeLabel } from '../../../lib/epName';
import { makeStaleGuard } from '../../../lib/staleGuard';
import { hydratePlayerInit } from './hydratePlayerInit';
import { recordOpenedPlayerEpisode } from './recordPlayerEpisode';
import { sourceIdentity } from './discoverPlaybackAlternatives';
import type {
  PlayerInitData,
  PlaybackRecoveryCause,
  PlayerPagePlaybackWorkflowPort,
  PlayerPageWorkflowHistoryPort,
  PlayerSourceMemoryPort,
} from './playerPageSession';
import { resolvePlayerPageEpisode, type ResolvePlayerPageEpisodeResult } from './resolvePlayerPageEpisode';
import type { PlayerPageResolutionState, PlayerPageSessionAction } from './playerPageSessionState';

const MAX_AUTOMATIC_PARSE_SWITCHES = 3;

export interface PlayerPageSessionWorkflowPorts {
  session: PlayerPagePlaybackWorkflowPort;
  history: PlayerPageWorkflowHistoryPort;
  sourceMemory: PlayerSourceMemoryPort;
  publish(action: PlayerPageSessionAction): void;
}

export interface PlayerPageSessionWorkflow {
  applyInit(incoming: PlayerInitData): Promise<void>;
  selectEpisode(index: number): void;
  retryCurrent(resolutionKind: PlayerPageResolutionState['kind']): void;
  autoChangeParse(currentPosition?: number, reason?: string, cause?: PlaybackRecoveryCause): Promise<boolean>;
  retryAlternativeSearch(currentPosition?: number): Promise<boolean>;
  selectAlternative(id: string): boolean;
  confirmPlaybackStarted(): void;
  dismissDriveBinding(): void;
  onDriveBound(resolutionKind: PlayerPageResolutionState['kind']): void;
  begin(): void;
  dispose(): void;
}

/** Owns the standalone player's hydration, parser retries, source failover, and teardown. */
export function createPlayerPageSessionWorkflow(
  ports: PlayerPageSessionWorkflowPorts,
): PlayerPageSessionWorkflow {
  const { session, history, sourceMemory, publish } = ports;
  const generation = makeStaleGuard();
  let currentInit: PlayerInitData | null = null;
  let pendingInit: PlayerInitData | null = null;
  let currentEpisodeIndex = 0;
  let parseOffset = 0;
  let automaticParseSwitches = 0;
  let fallbackSearchAttempted = false;
  let fallbackSearchPromise: Promise<boolean> | null = null;
  let fallbackSearchController: AbortController | null = null;
  let lastFallbackPosition = 0;
  const attemptedSourceIds = new Set<string>();
  const candidateById = new Map<string, { data: PlayerInitData; sourceName: string }>();

  const updateInit = (next: PlayerInitData) => {
    currentInit = next;
    publish({ type: 'init-updated', init: next });
  };

  const resetSourceFallback = (data: PlayerInitData) => {
    fallbackSearchAttempted = false;
    fallbackSearchPromise = null;
    fallbackSearchController?.abort();
    fallbackSearchController = null;
    attemptedSourceIds.clear();
    candidateById.clear();
    const currentId = sourceId(data);
    if (currentId) attemptedSourceIds.add(currentId);
    publish({ type: 'source-fallback-cleared' });
  };

  const resolve = async (
    data: PlayerInitData,
    index: number,
    preparedUrl = '',
    options?: { parseOffset?: number },
  ): Promise<ResolvePlayerPageEpisodeResult> => {
    if (!data.episodes || index < 0 || index >= data.episodes.length) return 'empty';
    const requestGeneration = generation.next();
    return resolvePlayerPageEpisode(
      { data, index, preparedUrl, parseOffset: options?.parseOffset },
      {
        playback: session,
        history,
        sourceMemory,
        publish,
        isCurrent: () => generation.isCurrent(requestGeneration),
      },
    );
  };

  async function resolveWithRecovery(data: PlayerInitData, index: number, preparedUrl = ''): Promise<void> {
    const result = await resolve(data, index, preparedUrl);
    if (result === 'failed' && currentInit && samePlaybackRequest(currentInit, data, index)) {
      const message = '当前解析线路没有返回可播放地址';
      void autoChangeParse(data.startTime || 0, message, 'resolution-failure');
    }
  }

  async function searchAlternativeSources(position: number, refresh = false): Promise<boolean> {
    if (fallbackSearchPromise) return fallbackSearchPromise;
    if (fallbackSearchAttempted) {
      return candidateById.size > 0 || Boolean(currentInit?.deferHistoryUntilPlayback);
    }
    const current = currentInit;
    if (!current || !session.discover) return false;

    fallbackSearchAttempted = true;
    lastFallbackPosition = Math.max(0, position);
    const searchGeneration = generation.next();
    const controller = new AbortController();
    fallbackSearchController = controller;
    publish({ type: 'source-fallback-searching' });

    const promise = Promise.resolve().then(async () => {
      try {
        const result = await session.discover({
          current,
          episodeIndex: currentEpisodeIndex,
          position: Math.max(0, position),
          excludedSourceIds: new Set(attemptedSourceIds),
          refresh,
        }, controller.signal);
        if (!generation.isCurrent(searchGeneration) || controller.signal.aborted) return true;

        candidateById.clear();
        for (const candidate of result.candidates) {
          if (attemptedSourceIds.has(candidate.id)) continue;
          candidateById.set(candidate.id, { data: candidate.data, sourceName: candidate.sourceName });
        }
        const candidates = result.candidates.filter(candidate => candidateById.has(candidate.id));
        // A candidate has already passed exact title/year/episode verification.
        // Unsearched sources cannot invalidate that evidence; requiring a complete
        // scan made failover impossible for large profiles with bounded search time.
        if (candidates.length > 0) {
          await startAlternative(candidates[0].id, position);
          return true;
        }

        const message = result.incompleteSources > 0 || result.truncated
          ? `目前没有找到已核验的同剧同集备用来源；${result.incompleteSources > 0 ? `还有 ${result.incompleteSources} 个来源或影片详情未完成` : '候选较多，尚有结果未核验'}。这不代表没有可播源，可以刷新备用源搜索。`
          : '已检查全部可搜索来源，仍没有找到已核验的同剧同集备用来源；可以手动切换来源或检查该集的源站权限。';
        publish({ type: 'source-fallback-unavailable', message });
        return true;
      } catch (error) {
        if (!generation.isCurrent(searchGeneration) || controller.signal.aborted) return true;
        const message = error instanceof Error ? error.message : String(error);
        publish({ type: 'source-fallback-unavailable', message: `备用源搜索失败：${message}` });
        return true;
      } finally {
        if (fallbackSearchController === controller) fallbackSearchController = null;
        if (fallbackSearchPromise === promise) fallbackSearchPromise = null;
      }
    });
    fallbackSearchPromise = promise;
    return promise;
  }

  async function startAlternative(id: string, position: number): Promise<boolean> {
    const candidate = candidateById.get(id);
    if (!candidate) return false;
    attemptedSourceIds.add(id);
    fallbackSearchAttempted = false;
    automaticParseSwitches = 0;
    parseOffset = 0;
    currentEpisodeIndex = candidate.data.epIndex;
    const next = {
      ...candidate.data,
      startTime: Math.max(0, position),
      deferHistoryUntilPlayback: true,
    };
    publish({ type: 'source-fallback-switching', sourceName: candidate.sourceName });
    updateInit(next);
    const result = await resolve(next, currentEpisodeIndex);
    if (result === 'drive-bind-required') {
      publish({ type: 'source-fallback-unavailable', message: `${candidate.sourceName} 需要先登录网盘，绑定后可继续播放。` });
      return true;
    }
    if (result === 'failed') {
      // Resolution failures get the same bounded parser retries as media failures.
      void autoChangeParse(position, '备用源解析失败', 'resolution-failure');
      return true;
    }
    return result !== 'empty';
  }

  async function autoChangeParse(
    currentPosition = 0,
    reason = '',
    cause: PlaybackRecoveryCause = 'resolution-failure',
  ): Promise<boolean> {
    if (isUserInterruption(reason)) return false;
    const current = currentInit;
    if (!current) return false;

    // A media engine has already exhausted the current URL. Cycling parser
    // strategies cannot repair a decoded/network stream failure, so search
    // verified sources immediately. Parser rotation remains for URL failures.
    if (cause === 'media-failure') return searchAlternativeSources(currentPosition);

    if (automaticParseSwitches < MAX_AUTOMATIC_PARSE_SWITCHES) {
      automaticParseSwitches += 1;
      parseOffset += 1;
      const next = currentPosition > 0 ? { ...current, startTime: currentPosition } : current;
      updateInit(next);
      const result = await resolve(next, currentEpisodeIndex, '', { parseOffset });
      if (result === 'failed') {
        return autoChangeParse(currentPosition, '解析线路未返回可播放地址', 'resolution-failure');
      }
      if (result === 'drive-bind-required') {
        return true;
      }
      return result !== 'stale' && result !== 'empty';
    }

    return searchAlternativeSources(currentPosition);
  }

  async function retryAlternativeSearch(currentPosition = lastFallbackPosition): Promise<boolean> {
    if (!currentInit || !session.discover || fallbackSearchPromise) return false;
    fallbackSearchAttempted = false;
    candidateById.clear();
    publish({ type: 'source-fallback-cleared' });
    return searchAlternativeSources(Math.max(0, currentPosition), true);
  }

  const applyInit = async (incoming: PlayerInitData) => {
    const requestGeneration = generation.next();
    resetSourceFallback(incoming);
    parseOffset = 0;
    automaticParseSwitches = 0;
    pendingInit = incoming;
    currentInit = null;
    publish({ type: 'hydration-started' });

    let hydrated: PlayerInitData | null;
    try {
      hydrated = await hydratePlayerInit(incoming, session, () => generation.isCurrent(requestGeneration));
    } catch (error) {
      if (!generation.isCurrent(requestGeneration)) return;
      publish({ type: 'hydration-failed', message: error instanceof Error ? error.message : String(error) });
      return;
    }

    if (!hydrated || !generation.isCurrent(requestGeneration)) return;
    resetSourceFallback(hydrated);
    pendingInit = null;
    updateInit(hydrated);
    const episodeIndex = Math.max(0, Math.min(hydrated.epIndex || 0, (hydrated.episodes?.length || 1) - 1));
    currentEpisodeIndex = episodeIndex;
    publish({ type: 'hydration-completed', init: hydrated, epIndex: episodeIndex });
    if (hydrated.episodes.length === 0) return;
    void resolveWithRecovery(hydrated, episodeIndex, hydrated.lastUrl);
  };

  const selectEpisode = (index: number) => {
    const current = currentInit;
    if (!current || !Number.isInteger(index) || index < 0 || index >= current.episodes.length) return;
    resetSourceFallback(current);
    parseOffset = 0;
    automaticParseSwitches = 0;
    currentEpisodeIndex = index;
    const next = { ...current, startTime: 0, lastUrl: '', epIndex: index };
    updateInit(next);
    void resolveWithRecovery(next, index);
  };

  const retryCurrent = (resolutionKind: PlayerPageResolutionState['kind']) => {
    if (resolutionKind === 'hydrating' || resolutionKind === 'resolving') return;
    automaticParseSwitches = 0;
    parseOffset = 0;
    const pending = pendingInit;
    if (pending) {
      void applyInit(pending);
      return;
    }
    const current = currentInit;
    if (current) {
      fallbackSearchAttempted = false;
      candidateById.clear();
      if (!current.deferHistoryUntilPlayback) publish({ type: 'source-fallback-cleared' });
      void resolveWithRecovery(current, currentEpisodeIndex);
    }
  };

  const selectAlternative = (id: string): boolean => {
    const candidate = candidateById.get(id);
    if (!candidate) return false;
    fallbackSearchAttempted = false;
    void startAlternative(id, candidate.data.startTime || currentInit?.startTime || 0);
    return true;
  };

  const confirmPlaybackStarted = () => {
    const current = currentInit;
    if (!current) return;
    if (current.deferHistoryUntilPlayback) {
      const committed = { ...current, deferHistoryUntilPlayback: false };
      currentInit = committed;
      publish({ type: 'init-updated', init: committed });
      const episode = committed.episodes[currentEpisodeIndex];
      if (episode) {
        const title = (committed.subtitleTitle || committed.title || '').trim();
        const episodeLabel = formatEpisodeLabel(episode.name, currentEpisodeIndex);
        const displayName = title ? `${title} - ${episodeLabel}` : episodeLabel;
        recordOpenedPlayerEpisode({
          data: committed,
          index: currentEpisodeIndex,
          displayName,
          episodeLabel,
        }, history, sourceMemory);
      }
      publish({ type: 'source-fallback-cleared' });
      return;
    }

    if (fallbackSearchController) {
      fallbackSearchController.abort();
      fallbackSearchController = null;
      fallbackSearchPromise = null;
      publish({ type: 'source-fallback-cleared' });
    }
  };

  return {
    applyInit,
    selectEpisode,
    retryCurrent,
    autoChangeParse,
    retryAlternativeSearch,
    selectAlternative,
    confirmPlaybackStarted,
    dismissDriveBinding: () => publish({ type: 'drive-bind-dismissed' }),
    onDriveBound: (resolutionKind) => {
      publish({ type: 'drive-bind-dismissed' });
      retryCurrent(resolutionKind);
    },
    begin: () => history.beginPlayerHistorySession(),
    dispose: () => {
      generation.next();
      fallbackSearchController?.abort();
      fallbackSearchController = null;
      fallbackSearchPromise = null;
      pendingInit = null;
      currentInit = null;
      void session.cleanupTemporaryFiles().catch(() => undefined);
    },
  };
}

function sourceId(data: PlayerInitData): string | null {
  const profileId = data.meta?.profileId || '';
  const sourceKey = data.meta?.fromKey || data.key;
  const vodId = data.meta?.vodId || data.meta?.id || '';
  return profileId && sourceKey && vodId ? sourceIdentity(profileId, sourceKey, vodId) : null;
}

function samePlaybackRequest(current: PlayerInitData, requested: PlayerInitData, index: number): boolean {
  return currentEpisodeIndexFor(current) === index
    && current.key === requested.key
    && (current.meta?.profileId || '') === (requested.meta?.profileId || '')
    && current.episodes[index]?.url === requested.episodes[index]?.url;
}

function currentEpisodeIndexFor(data: PlayerInitData): number {
  return data.epIndex;
}

function isUserInterruption(reason: string): boolean {
  return /\b(?:abort(?:ed)?|cancel(?:led)?|stopped|ended)\b|中止|取消|用户停止|播放结束/i.test(reason);
}
