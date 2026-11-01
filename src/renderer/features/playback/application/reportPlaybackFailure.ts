import { classifyPlaybackFailure, playbackFailureSummary, type PlaybackFailureContext } from '../../../../shared/playbackFailure';

export interface PlaybackFailureEffects {
  autoChangeParse?: (currentTime: number, reason: string, cause: 'media-failure', failure?: PlaybackFailureContext) => Promise<boolean> | boolean;
  onPlaybackFailure?: (currentTime: number, reason: string, failure?: PlaybackFailureContext) => void;
  notify: (message: string) => void;
}

/** Coordinates playback recovery callbacks without depending on React or a player engine. */
export function reportPlaybackFailure(
  currentTime: number,
  reason: string,
  effects: PlaybackFailureEffects,
  failure?: PlaybackFailureContext,
): Promise<void> {
  let autoChange: Promise<boolean> | undefined;
  const failureContext = failure ?? classifyPlaybackFailure({ engine: 'unknown', reason });

  if (effects.autoChangeParse) {
    const explanation = playbackFailureSummary(failureContext);
    effects.notify(`${explanation}，正在查找已核验的同集备用来源…`);
    try {
      autoChange = Promise.resolve(effects.autoChangeParse(currentTime, reason, 'media-failure', failureContext));
    } catch (error) {
      effects.notify(`备用来源检索失败：${errorMessage(error)}`);
    }
  }

  effects.onPlaybackFailure?.(currentTime, reason, failureContext);

  return autoChange?.then((started) => {
    if (!started) effects.notify('暂未找到已核验的备用来源；可重新搜索，或切换到其他播放源。');
  }).catch((error: unknown) => {
    effects.notify(`备用来源检索失败：${errorMessage(error)}`);
  }) ?? Promise.resolve();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
