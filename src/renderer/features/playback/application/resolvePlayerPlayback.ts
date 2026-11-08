import type { PlayResult } from '../../../../shared/types';
import type { PlayerPlaybackResolutionPort, PlayerInitData } from './playerPageSession';

export async function resolvePlayerPlayback(
  data: PlayerInitData,
  index: number,
  preparedUrl: string,
  port: PlayerPlaybackResolutionPort,
  options?: { parseOffset?: number; preparedResult?: PlayResult; fastRecovery?: boolean },
): Promise<PlayResult> {
  if (options?.preparedResult) return options.preparedResult;
  if (preparedUrl) return { url: preparedUrl, parse: 0, flag: data.flag, playUrl: '' };
  const episode = data.episodes[index];
  if (!episode) throw new RangeError('播放集数超出当前剧集列表');
  return port.play({
    key: data.key,
    flag: data.flag,
    id: episode.url,
    profileId: data.meta?.profileId,
    parseOffset: options?.parseOffset,
    fastRecovery: options?.fastRecovery,
  });
}
