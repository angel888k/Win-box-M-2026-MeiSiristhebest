import type { PlayerInitData, PlayerPlaybackKind } from '../../../../shared/playerInit';

export interface StandalonePlayerRequestInput {
  url: string;
  title: string;
  playbackKind: Exclude<PlayerPlaybackKind, 'vod'>;
  profileId?: string;
  sourceName?: string;
}

/** Build a direct-play handoff without VOD source identity or history side effects. */
export function buildStandalonePlayerRequest(input: StandalonePlayerRequestInput): PlayerInitData {
  const title = input.title.trim() || '正在播放';
  return {
    key: '',
    flag: '',
    episodes: [{ name: title, url: input.url }],
    epIndex: 0,
    title,
    lastUrl: input.url,
    lastName: title,
    playbackKind: input.playbackKind,
    recordHistory: false,
    meta: {
      profileId: input.profileId,
      sourceName: input.sourceName,
    },
  };
}
