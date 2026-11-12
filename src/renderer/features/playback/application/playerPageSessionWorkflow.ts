import { formatEpisodeLabel } from '../../../lib/epName';
import { makeStaleGuard } from '../../../lib/staleGuard';
import { hydratePlayerInit } from './hydratePlayerInit';
import { recordOpenedPlayerEpisode } from './recordPlayerEpisode';
import { sourceIdentity } from './discoverPlaybackAlternatives';
import { playbackFailureSummary, type PlaybackFailureContext } from '../../../../shared/playbackFailure';
import type { PlayResult } from '../../../../shared/types';
import type {
  PlayerInitData,
  PlaybackRecoveryCause,
  PlayerPagePlaybackWorkflowPort,
  PlayerPageWorkflowHistoryPort,
  PlayerSourceMemoryPort,
} from './playerPageSession';
import { resolvePlayerPageEpisode, type ResolvePlayerPageEpisodeResult } from './resolvePlayerPageEpisode';
import type { PlayerPageResolutionState, PlayerPageSessionAction } from './playerPageSessionState';

const PREWARM_TTL_MS = 60_000;
const AUTOMATIC_FAILOVER_BUDGET_MS = 45_000;
const AUTOMATIC_CANDIDATE_ATTEMPT_BUDGET_MS = 18_000;
type AlternativeAttemptOutcome = 'resolved' | 'failed' | 'interrupted';

export interface PlayerPageSessionWorkflowPorts {
  session: PlayerPagePlaybackWorkflowPort;
  history: PlayerPageWorkflowHistoryPort;
  sourceMemory: PlayerSourceMemoryPort;
  publish(action: PlayerPageSessionAction): void;
}

export interface PlayerPageSessionWorkflow {
  applyInit(incoming: PlayerInitData): Promise<void>;
  selectEpisode(index: number): void;
  prepareNextEpisode(): Promise<boolean>;
  retryCurrent(resolutionKind: PlayerPageResolutionState['kind']): void;
  autoChangeParse(currentPosition?: number, reason?: string, cause?: PlaybackRecoveryCause, failure?: PlaybackFailureContext): Promise<boolean>;
  retryAlternativeSearch(currentPosition?: number): Promise<boolean>;
  selectAlternative(id: string, currentPosition?: number): boolean;
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
  let fallbackSearchAttempted = false;
  let fallbackSearchPromise: Promise<boolean> | null = null;
  let fallbackSearchController: AbortController | null = null;
  let fallbackGeneration = 0;
  let automaticFailoverStartedAt: number | null = null;
  let queuedAlternativeAttempt: Promise<boolean> | null = null;
  let resolvedAlternativeId: string | null = null;
  let fallbackExhaustionReported = false;
  let lastFallbackPosition = 0;
  let lastPlaybackFailure: PlaybackFailureContext | undefined;
  let lastResolutionFailureMessage = '';
  let automaticDriveSkipCount = 0;
  let prewarmController: AbortController | null = null;
  let prewarmingKey = '';
  let preparedEpisode: { key: string; result: PlayResult; expiresAt: number } | null = null;
  const attemptedSourceIds = new Set<string>();
  const attemptedFlags = new Set<string>();
  const resolvedCandidateIds = new Set<string>();
  const candidateById = new Map<string, { data: PlayerInitData; sourceName: string }>();

  const remainingAutomaticFailoverMs = (): number => automaticFailoverStartedAt === null
    ? AUTOMATIC_FAILOVER_BUDGET_MS
    : Math.max(0, AUTOMATIC_FAILOVER_BUDGET_MS - (Date.now() - automaticFailoverStartedAt));

  const automaticDriveSkipNote = (): string => automaticDriveSkipCount > 0
    ? `已自动跳过 ${automaticDriveSkipCount} 个需要网盘解链或转存的候选；这些来源仍可在列表中手动选择。`
    : '';

  const reportAutomaticFailoverBudget = () => {
    if (fallbackExhaustionReported) return;
    fallbackExhaustionReported = true;
    const attemptedCount = [...candidateById.keys()].filter(id => attemptedSourceIds.has(id)).length;
    const elapsedSeconds = automaticFailoverStartedAt === null
      ? 0
      : Math.max(0, Math.floor((Date.now() - automaticFailoverStartedAt) / 1000));
    publish({
      type: 'source-fallback-unavailable',
      message: `自动换源已运行约 ${elapsedSeconds} 秒并尝试了 ${attemptedCount} 个同剧同集来源；为避免继续等待，已暂停自动试播。${automaticDriveSkipNote()}已核验候选仍可手动切换，也可以重新搜索。`,
    });
  };

  const reportAlternativeExhausted = () => {
    if (fallbackExhaustionReported || resolvedAlternativeId || candidateById.size === 0) return;
    fallbackExhaustionReported = true;
    const resolvedCount = [...candidateById.keys()].filter(id => resolvedCandidateIds.has(id)).length;
    const message = resolvedCount > 0
      ? `已核验 ${candidateById.size} 个同剧同集来源，其中 ${resolvedCount} 个取得过播放地址但未能正常播放，其余来源未能解析；可以手动切换来源或重新搜索。`
      : `已核验的 ${candidateById.size} 个同剧同集来源都未能取得可播放地址；可以手动切换来源或重新搜索。`;
    publish({ type: 'source-fallback-unavailable', message: `${automaticDriveSkipNote()}${message}` });
  };

  const cancelPrewarm = () => {
    prewarmController?.abort(new Error('下一集预解析已取消'));
    prewarmController = null;
    prewarmingKey = '';
    preparedEpisode = null;
  };

  const episodeIdentity = (data: PlayerInitData, index: number): string => {
    const episode = data.episodes[index];
    return episode ? [data.meta?.profileId || '', data.key, data.flag, episode.url].join('\u0000') : '';
  };

  const updateInit = (next: PlayerInitData) => {
    currentInit = next;
    publish({ type: 'init-updated', init: next });
  };

  const resetSourceFallback = (data: PlayerInitData) => {
    fallbackGeneration += 1;
    automaticFailoverStartedAt = null;
    fallbackSearchAttempted = false;
    fallbackSearchPromise = null;
    queuedAlternativeAttempt = null;
    resolvedAlternativeId = null;
    fallbackExhaustionReported = false;
    fallbackSearchController?.abort();
    fallbackSearchController = null;
    attemptedSourceIds.clear();
    attemptedFlags.clear();
    if (data.flag) attemptedFlags.add(data.flag);
    candidateById.clear();
    resolvedCandidateIds.clear();
    lastPlaybackFailure = undefined;
    lastResolutionFailureMessage = '';
    automaticDriveSkipCount = 0;
    const currentId = sourceId(data);
    if (currentId) attemptedSourceIds.add(currentId);
    publish({ type: 'source-fallback-cleared' });
  };

  const stopFallbackDiscovery = () => {
    fallbackGeneration += 1;
    automaticFailoverStartedAt = null;
    fallbackSearchController?.abort(new Error('已确认播放恢复'));
    fallbackSearchController = null;
    fallbackSearchPromise = null;
    queuedAlternativeAttempt = null;
    resolvedAlternativeId = null;
    fallbackExhaustionReported = false;
    lastResolutionFailureMessage = '';
    automaticDriveSkipCount = 0;
    attemptedFlags.clear();
    if (currentInit?.flag) attemptedFlags.add(currentInit.flag);
    candidateById.clear();
    resolvedCandidateIds.clear();
    publish({ type: 'source-fallback-cleared' });
  };

  const resolve = async (
    data: PlayerInitData,
    index: number,
    preparedUrl = '',
    options?: { parseOffset?: number; preparedResult?: PlayResult; fastRecovery?: boolean },
  ): Promise<ResolvePlayerPageEpisodeResult> => {
    if (!data.episodes || index < 0 || index >= data.episodes.length) return 'empty';
    const requestGeneration = generation.next();
    return resolvePlayerPageEpisode(
      { data, index, preparedUrl, preparedResult: options?.preparedResult, parseOffset: options?.parseOffset, fastRecovery: options?.fastRecovery },
      {
        playback: session,
        publish: action => {
          if (action.type === 'resolution-failed') lastResolutionFailureMessage = action.message;
          publish(action);
        },
        isCurrent: () => generation.isCurrent(requestGeneration),
      },
    );
  };

  async function resolveWithRecovery(data: PlayerInitData, index: number, preparedUrl = '', preparedResult?: PlayResult): Promise<void> {
    const result = await resolve(data, index, preparedUrl, { preparedResult });
    if (result === 'failed' && currentInit && samePlaybackRequest(currentInit, data, index)) {
      const message = '当前解析线路没有返回可播放地址';
      void autoChangeParse(data.startTime || 0, message, 'resolution-failure');
    }
  }

  async function searchAlternativeSources(position: number, refresh = false): Promise<boolean> {
    if (fallbackSearchPromise) {
      const readyAlternative = [...candidateById.keys()].some(id => !attemptedSourceIds.has(id));
      if (readyAlternative) return attemptNextQueuedAlternative(position);
      const activeGeneration = fallbackGeneration;
      return fallbackSearchPromise.then(async (searched) => {
        if (activeGeneration !== fallbackGeneration) return false;
        const attempted = await attemptNextQueuedAlternative(position);
        return attempted || searched;
      });
    }
    const queuedCandidate = [...candidateById.entries()].find(([id]) => !attemptedSourceIds.has(id));
    if (queuedCandidate) return attemptNextQueuedAlternative(position);
    if (fallbackSearchAttempted) {
      return candidateById.size > 0 || Boolean(currentInit?.deferHistoryUntilPlayback);
    }
    const current = currentInit;
    if (!current || !session.discover) return false;

    fallbackSearchAttempted = true;
    lastFallbackPosition = Math.max(0, position);
    // Discovery has its own lifetime. Resolving the first verified candidate
    // advances the playback generation, but must not invalidate the still-live
    // search that is collecting later fallback candidates.
    const searchGeneration = ++fallbackGeneration;
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
        }, controller.signal, candidate => {
          if (fallbackGeneration !== searchGeneration || controller.signal.aborted || attemptedSourceIds.has(candidate.id)) return;
          candidateById.set(candidate.id, { data: candidate.data, sourceName: candidate.sourceName });
          fallbackExhaustionReported = false;
          publish({
            type: 'source-fallback-candidate-found',
            candidate: {
              id: candidate.id,
              sourceName: candidate.sourceName,
              profileName: candidate.profileName,
            },
          });
          void attemptNextQueuedAlternative(position);
        });
        if (fallbackGeneration !== searchGeneration || controller.signal.aborted) return true;

        for (const candidate of result.candidates) {
          candidateById.set(candidate.id, { data: candidate.data, sourceName: candidate.sourceName });
        }
        const candidates = result.candidates;
        publish({
          type: 'source-fallback-candidates-updated',
          candidates: candidates.map(candidate => ({
            id: candidate.id,
            sourceName: candidate.sourceName,
            profileName: candidate.profileName,
          })),
          incompleteSources: result.incompleteSources,
          searchIncomplete: result.searchIncomplete === true,
          truncated: result.truncated,
        });
        // A candidate has already passed exact title/year/episode verification.
        // Unsearched sources cannot invalidate that evidence; requiring a complete
        // scan made failover impossible for large profiles with bounded search time.
        if (candidateById.size > 0) {
          void attemptNextQueuedAlternative(position);
          // Keep later exact candidates queued. Try the next only after the
          // active candidate fails, so two sources never start at once.
          return true;
        }

        const failureNote = lastPlaybackFailure ? `${playbackFailureSummary(lastPlaybackFailure)}。` : '';
        const message = result.searchIncomplete
          ? `${failureNote}备用源搜索达到时间上限；当前没有发现已核验候选，且全源检查尚未完成。${result.incompleteSources > 0 ? `另有 ${result.incompleteSources} 个来源或影片详情未完成核验。` : ''}这不代表没有可播源，可以重新搜索或手动切换来源。`
          : result.incompleteSources > 0 || result.truncated
          ? `${failureNote}目前没有找到已核验的同剧同集备用来源；${result.incompleteSources > 0 ? `还有 ${result.incompleteSources} 个来源或影片详情未完成` : '候选较多，尚有结果未核验'}。这不代表没有可播源，可以刷新备用源搜索。`
          : `${failureNote}已检查全部可搜索来源，仍没有找到已核验的同剧同集备用来源；可以手动切换来源或检查该集的源站权限。`;
        publish({ type: 'source-fallback-unavailable', message });
        return true;
      } catch (error) {
        if (fallbackGeneration !== searchGeneration || controller.signal.aborted) return true;
        const message = error instanceof Error ? error.message : String(error);
        const failureNote = lastPlaybackFailure ? `${playbackFailureSummary(lastPlaybackFailure)}。` : '';
        publish({ type: 'source-fallback-unavailable', message: `${failureNote}备用源搜索失败：${message}` });
        return true;
      } finally {
        if (fallbackSearchController === controller) fallbackSearchController = null;
        if (fallbackSearchPromise === promise) fallbackSearchPromise = null;
        if (!resolvedAlternativeId && candidateById.size > 0) {
          void attemptNextQueuedAlternative(lastFallbackPosition);
        }
      }
    });
    fallbackSearchPromise = promise;
    return promise;
  }

  function attemptNextQueuedAlternative(position: number): Promise<boolean> {
    if (queuedAlternativeAttempt) return queuedAlternativeAttempt;
    if (resolvedAlternativeId) return Promise.resolve(false);
    const hasUnattemptedCandidate = [...candidateById.keys()].some(id => !attemptedSourceIds.has(id));
    if (hasUnattemptedCandidate && remainingAutomaticFailoverMs() < AUTOMATIC_CANDIDATE_ATTEMPT_BUDGET_MS) {
      reportAutomaticFailoverBudget();
      return Promise.resolve(false);
    }
    if (!hasUnattemptedCandidate) {
      if (candidateById.size > 0 && !fallbackSearchPromise && !fallbackExhaustionReported) {
        reportAlternativeExhausted();
      }
      return Promise.resolve(false);
    }
    const attempt = (async () => {
      while (!resolvedAlternativeId) {
        const candidate = [...candidateById.entries()].find(([id]) => !attemptedSourceIds.has(id));
        if (!candidate) return false;
        const outcome = await startAlternative(candidate[0], position, true);
        if (outcome === 'resolved') return true;
        if (outcome === 'interrupted') return false;
      }
      return false;
    })().finally(() => {
      if (queuedAlternativeAttempt === attempt) queuedAlternativeAttempt = null;
      const hasQueuedCandidate = [...candidateById.keys()].some(id => !attemptedSourceIds.has(id));
      if (!resolvedAlternativeId && hasQueuedCandidate) {
        void attemptNextQueuedAlternative(position);
      } else if (!resolvedAlternativeId && candidateById.size > 0 && !fallbackSearchPromise && !fallbackExhaustionReported) {
        reportAlternativeExhausted();
      }
    });
    queuedAlternativeAttempt = attempt;
    return attempt;
  }

  async function startAlternative(id: string, position: number, automatic = false): Promise<AlternativeAttemptOutcome> {
    const candidate = candidateById.get(id);
    if (!candidate) return 'interrupted';
    if (automatic && remainingAutomaticFailoverMs() < AUTOMATIC_CANDIDATE_ATTEMPT_BUDGET_MS) {
      reportAutomaticFailoverBudget();
      return 'interrupted';
    }
    cancelPrewarm();
    attemptedSourceIds.add(id);
    resolvedCandidateIds.delete(id);
    resolvedAlternativeId = null;
    fallbackSearchAttempted = false;
    currentEpisodeIndex = candidate.data.epIndex;
    const next = {
      ...candidate.data,
      startTime: Math.max(0, position),
      deferHistoryUntilPlayback: true,
      fastRecovery: automatic,
    };
    lastResolutionFailureMessage = '';
    publish({
      type: 'source-fallback-switching',
      sourceName: candidate.sourceName,
      candidateId: id,
      message: automaticDriveSkipCount > 0 ? `${automaticDriveSkipNote()}正在继续尝试。` : undefined,
    });
    updateInit(next);
    const result = await resolve(next, currentEpisodeIndex, '', { fastRecovery: automatic });
    if (result === 'drive-bind-required') {
      if (!automatic) {
        publish({ type: 'source-fallback-unavailable', message: `${candidate.sourceName} 需要先登录网盘，绑定后可继续播放。` });
        return 'resolved';
      }
      publish({ type: 'drive-bind-dismissed' });
      return 'failed';
    }
    if (result === 'failed') {
      if (automatic) {
        if (lastResolutionFailureMessage.includes('自动换源跳过需要网盘解链或转存的候选')) {
          automaticDriveSkipCount += 1;
        }
        return 'failed';
      }
      // Manual selection keeps the existing parser fallback for the chosen source.
      void autoChangeParse(position, '备用源解析失败', 'resolution-failure');
      return 'resolved';
    }
    if (result === 'resolved') {
      resolvedAlternativeId = id;
      resolvedCandidateIds.add(id);
      return 'resolved';
    }
    return 'interrupted';
  }

  /** ★ 核心自愈优化：同片多线路秒级自动轮换（免去漫长的全网跨源大爬虫搜索） */
  async function attemptNextFlagInCurrentSource(position: number): Promise<boolean> {
    let current = currentInit;
    if (!current || !current.key) return false;

    let flags = current.meta?.flags;
    let allEpisodes = current.meta?.allEpisodes;

    if (!flags || !allEpisodes) {
      const vodId = current.meta?.vodId || current.meta?.id;
      if (vodId && session.loadDetail) {
        try {
          const detail = await session.loadDetail({
            key: current.key,
            ids: [vodId],
            profileId: current.meta?.profileId,
          });
          if (detail && detail.episodes) {
            flags = detail.flags || Object.keys(detail.episodes);
            allEpisodes = detail.episodes;
            current = {
              ...current,
              meta: { ...current.meta, flags, allEpisodes },
            };
            updateInit(current);
          }
        } catch {
          // 详情加载失败则直接跳过同片换线
        }
      }
    }

    if (!flags || !allEpisodes || !Array.isArray(flags)) return false;

    const curEp = current.episodes[currentEpisodeIndex];
    const curEpName = (curEp?.name || '').trim();

    for (const flagName of flags) {
      if (!flagName || attemptedFlags.has(flagName)) continue;
      const episodesForFlag = allEpisodes[flagName];
      if (!Array.isArray(episodesForFlag) || episodesForFlag.length === 0) continue;

      let matchedIndex = -1;
      if (curEpName) {
        matchedIndex = episodesForFlag.findIndex((e) => e.name.trim() === curEpName);
      }
      if (matchedIndex < 0 && currentEpisodeIndex >= 0 && currentEpisodeIndex < episodesForFlag.length) {
        matchedIndex = currentEpisodeIndex;
      }
      if (matchedIndex < 0) continue;

      attemptedFlags.add(flagName);
      const targetEpisode = episodesForFlag[matchedIndex];

      publish({
        type: 'source-fallback-switching',
        sourceName: `${current.meta?.sourceName || current.key} · ${flagName}`,
        candidateId: `${current.key}:${flagName}`,
        message: `当前线路播放遇到问题，已自动切换至【${flagName}】继续播放...`,
      });

      const nextInit: PlayerInitData = {
        ...current,
        flag: flagName,
        episodes: episodesForFlag,
        epIndex: matchedIndex,
        lastUrl: targetEpisode.url,
        lastName: `${current.title} - ${targetEpisode.name}`,
        startTime: position,
        fastRecovery: true,
      };
      currentEpisodeIndex = matchedIndex;
      updateInit(nextInit);

      const result = await resolve(nextInit, matchedIndex, '', { fastRecovery: true });
      if (result === 'resolved') {
        return true;
      }
      if (result === 'drive-bind-required') {
        return false;
      }
    }

    return false;
  }

  async function autoChangeParse(
    currentPosition = 0,
    reason = '',
    cause: PlaybackRecoveryCause = 'resolution-failure',
    failure?: PlaybackFailureContext,
  ): Promise<boolean> {
    if (isUserInterruption(reason)) return false;
    let current = currentInit;
    if (!current) return false;

    // Live, catch-up and WebDAV URLs are already resolved resources. Sending
    // them through the VOD spider/search fallback turns transport failures
    // into unrelated parser errors and can trigger a search for a channel name.
    if (current.playbackKind && current.playbackKind !== 'vod') return false;
    cancelPrewarm();

    const resumePosition = Math.max(0, Number.isFinite(currentPosition) ? currentPosition : 0);
    if (current.startTime !== resumePosition) {
      current = { ...current, startTime: resumePosition };
      updateInit(current);
    }

    automaticFailoverStartedAt ??= Date.now();

    if (cause === 'media-failure') {
      lastPlaybackFailure = failure;
      resolvedAlternativeId = null;
      if (failure) publish({ type: 'playback-failure-reported', failure });
      if (remainingAutomaticFailoverMs() < AUTOMATIC_CANDIDATE_ATTEMPT_BUDGET_MS) {
        reportAutomaticFailoverBudget();
        return false;
      }
    }

    // ★ 步骤一：优先尝试当前影片自带的其他线路（flags）秒级续播！
    const switched = await attemptNextFlagInCurrentSource(resumePosition);
    if (switched) return true;

    // ★ 步骤二：本片自带线路已全部耗尽或仅有一条线路时，再降级触发跨源全网大搜索
    return searchAlternativeSources(resumePosition);
  }

  async function retryAlternativeSearch(currentPosition = lastFallbackPosition): Promise<boolean> {
    if (!currentInit || !session.discover || fallbackSearchPromise) return false;
    fallbackSearchAttempted = false;
    automaticFailoverStartedAt = Date.now();
    candidateById.clear();
    resolvedCandidateIds.clear();
    fallbackExhaustionReported = false;
    publish({ type: 'source-fallback-cleared' });
    return searchAlternativeSources(Math.max(0, currentPosition), true);
  }

  const applyInit = async (incoming: PlayerInitData) => {
    const initial = { ...incoming, fastRecovery: false };
    cancelPrewarm();
    const requestGeneration = generation.next();
    resetSourceFallback(initial);
    pendingInit = initial;
    currentInit = null;
    publish({ type: 'hydration-started' });

    let hydrated: PlayerInitData | null;
    try {
      hydrated = await hydratePlayerInit(initial, session, () => generation.isCurrent(requestGeneration));
    } catch (error) {
      if (!generation.isCurrent(requestGeneration)) return;
      publish({ type: 'hydration-failed', message: error instanceof Error ? error.message : String(error) });
      return;
    }

    if (!hydrated || !generation.isCurrent(requestGeneration)) return;
    resetSourceFallback(hydrated);
    pendingInit = null;
    const playbackInit = {
      ...hydrated,
      deferHistoryUntilPlayback: hydrated.recordHistory !== false,
    };
    updateInit(playbackInit);
    const episodeIndex = Math.max(0, Math.min(hydrated.epIndex || 0, (hydrated.episodes?.length || 1) - 1));
    currentEpisodeIndex = episodeIndex;
    publish({ type: 'hydration-completed', init: playbackInit, epIndex: episodeIndex });
    if (playbackInit.episodes.length === 0) return;
    void resolveWithRecovery(playbackInit, episodeIndex, playbackInit.lastUrl);
  };

  const selectEpisode = (index: number) => {
    const current = currentInit;
    if (!current || !Number.isInteger(index) || index < 0 || index >= current.episodes.length) return;
    const expectedKey = episodeIdentity(current, index);
    const prepared = preparedEpisode?.key === expectedKey && preparedEpisode.expiresAt > Date.now()
      ? preparedEpisode.result : undefined;
    cancelPrewarm();
    resetSourceFallback(current);
    currentEpisodeIndex = index;
    const next = { ...current, startTime: 0, lastUrl: '', epIndex: index, deferHistoryUntilPlayback: true };
    next.fastRecovery = false;
    updateInit(next);
    void resolveWithRecovery(next, index, '', prepared);
  };

  const prepareNextEpisode = async (): Promise<boolean> => {
    const data = currentInit;
    const index = currentEpisodeIndex + 1;
    if (!data || (data.playbackKind && data.playbackKind !== 'vod') || index >= data.episodes.length || !session.prewarm) return false;
    const key = episodeIdentity(data, index);
    if (!key) return false;
    if (preparedEpisode?.key === key && preparedEpisode.expiresAt > Date.now()) return true;
    if (prewarmController && prewarmingKey === key) return true;
    cancelPrewarm();
    const controller = new AbortController();
    prewarmController = controller;
    prewarmingKey = key;
    const episode = data.episodes[index];
    try {
      const result = await session.prewarm({
        key: data.key,
        flag: data.flag,
        id: episode.url,
        profileId: data.meta?.profileId,
      }, controller.signal);
      if (controller.signal.aborted || prewarmController !== controller || currentInit !== data
        || currentEpisodeIndex + 1 !== index || !result?.url || result.parse !== 0) return false;
      preparedEpisode = { key, result, expiresAt: Date.now() + PREWARM_TTL_MS };
      return true;
    } catch {
      return false;
    } finally {
      if (prewarmController === controller) {
        prewarmController = null;
        prewarmingKey = '';
      }
    }
  };

  const retryCurrent = (resolutionKind: PlayerPageResolutionState['kind']) => {
    if (resolutionKind === 'hydrating' || resolutionKind === 'resolving') return;
    cancelPrewarm();
    const pending = pendingInit;
    if (pending) {
      void applyInit(pending);
      return;
    }
    const current = currentInit;
    if (current) {
      const retry = { ...current, fastRecovery: false };
      resetSourceFallback(retry);
      updateInit(retry);
      const directUrl = retry.playbackKind && retry.playbackKind !== 'vod' ? retry.lastUrl : '';
      void resolveWithRecovery(retry, currentEpisodeIndex, directUrl);
    }
  };

  const selectAlternative = (id: string, currentPosition?: number): boolean => {
    const candidate = candidateById.get(id);
    if (!candidate) return false;
    automaticFailoverStartedAt = Date.now();
    fallbackExhaustionReported = false;
    fallbackSearchAttempted = false;
    const targetPosition = currentPosition !== undefined && currentPosition > 0
      ? currentPosition
      : (candidate.data.startTime || currentInit?.startTime || 0);
    void startAlternative(id, targetPosition);
    return true;
  };

  const confirmPlaybackStarted = () => {
    try {
      (window as unknown as { api?: { media?: { report?: (ev: unknown) => void } } })?.api?.media?.report?.({ event: 'playing' });
    } catch {
      /* ignore */
    }
    const current = currentInit;
    if (!current) return;
    stopFallbackDiscovery();
    if (current.deferHistoryUntilPlayback) {
      const committed = { ...current, deferHistoryUntilPlayback: false, fastRecovery: false };
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
      return;
    }
  };

  return {
    applyInit,
    selectEpisode,
    prepareNextEpisode,
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
      cancelPrewarm();
      generation.next();
      fallbackGeneration += 1;
      fallbackSearchController?.abort();
      fallbackSearchController = null;
      fallbackSearchPromise = null;
      queuedAlternativeAttempt = null;
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
