import { client } from '../../../api/client';
import { resolveHistorySource } from '../../../lib/historySource';
import { movieSourcesSearchAdapter } from '../../discovery/adapters/movieSourcesAdapters';
import { searchMovieSources } from '../../discovery/application/movieSourcesUseCases';
import { discoverPlaybackAlternatives } from '../application/discoverPlaybackAlternatives';
import type { PlayerInitData, PlayerPageSessionPort } from '../application/playerPageSession';

export const playerPageSessionAdapter: PlayerPageSessionPort = {
  play: (input) => client.play(input),
  resolveHistorySource: ({ profileId, sourceKey, sourceName }) => resolveHistorySource(client, {
    profileId,
    sourceKey,
    sourceName,
  }),
  loadDetail: (input) => client.detail(input),
    discover: async (input, signal, onCandidate) => discoverPlaybackAlternatives(input, {
      search: async (query, searchSignal, onReport, refresh = false) => {
        const result = await searchMovieSources(query, refresh, movieSourcesSearchAdapter,
          update => onReport(update.report), searchSignal);
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
