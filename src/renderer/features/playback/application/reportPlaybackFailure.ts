export interface PlaybackFailureEffects {
  autoChangeParse?: (currentTime: number, reason: string, cause: 'media-failure') => Promise<boolean> | boolean;
  onPlaybackFailure?: (currentTime: number, reason: string) => void;
  notify: (message: string) => void;
}

/** Coordinates playback recovery callbacks without depending on React or a player engine. */
export function reportPlaybackFailure(
  currentTime: number,
  reason: string,
  effects: PlaybackFailureEffects,
): Promise<void> {
  let autoChange: Promise<boolean> | undefined;

  if (effects.autoChangeParse) {
    effects.notify(`当前媒体流播放失败（${reason}），正在查找已核验的同集备用来源…`);
    try {
      autoChange = Promise.resolve(effects.autoChangeParse(currentTime, reason, 'media-failure'));
    } catch (error) {
      effects.notify(`备用来源检索失败：${errorMessage(error)}`);
    }
  }

  effects.onPlaybackFailure?.(currentTime, reason);

  return autoChange?.then((started) => {
    if (!started) effects.notify('暂未找到已核验的备用来源；可重新搜索，或切换到其他播放源。');
  }).catch((error: unknown) => {
    effects.notify(`备用来源检索失败：${errorMessage(error)}`);
  }) ?? Promise.resolve();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
