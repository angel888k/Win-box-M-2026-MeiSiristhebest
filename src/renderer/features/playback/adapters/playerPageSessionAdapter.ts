import { client } from '../../../api/client';
import { resolveHistorySource } from '../../../lib/historySource';
import { movieSourcesSearchAdapter } from '../../discovery/adapters/movieSourcesAdapters';
import { searchMovieSources } from '../../discovery/application/movieSourcesUseCases';
import { discoverPlaybackAlternatives } from '../application/discoverPlaybackAlternatives';
import type { PlayerInitData, PlayerPageSessionPort } from '../application/playerPageSession';

export const playerPageSessionAdapter: PlayerPageSessionPort = {
  play: (input) => client.play(input),
  prewarm: (input, signal) => client.prewarmPlay(input, signal),
  resolveHistorySource: ({ profileId, sourceKey, sourceName }) => resolveHistorySource(client, {
    profileId,
    sourceKey,
    sourceName,
  }),
  loadDetail: (input) => client.detail(input),
  discover: async (input, signal, onCandidate) => discoverPlaybackAlternatives(input, {
    search: async (query, searchSignal, onReport, refresh = false) => {
      const result = await searchMovieSources(query, refresh, movieSourcesSearchAdapter, undefined, searchSignal, {
        priorityProfileId: input.current.meta?.profileId,
        onSource: (sourceReport, progress) => onReport({
          ...sourceReport,
          pendingSources: Math.max(0, progress.total - progress.done),
        }),
        onSearchProgress: progress => onReport({
          items: [],
          perSource: [],
          hitSources: 0,
          failedSources: 0,
          totalRaw: 0,
          pendingSources: Math.max(0, progress.total - progress.done),
        }),
      });
      return result.report;
    },
    loadDetail: ({ key, id, profileId }, detailSignal) => client.detail({ key, ids: [id], profileId }, detailSignal),
  }, signal, onCandidate),
  onInit: (listener) => client.playerOnInit((data) => {
    if (data) listener(data as PlayerInitData);
  }),
  onEpisodeSwitch: (listener) => client.playerOnSwitchEp(listener),
  ready: async () => { await client.playerReady(); },
  cleanupTemporaryFiles: () => client.quarkCleanup(),
};
