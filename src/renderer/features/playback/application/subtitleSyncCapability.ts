import type { Kernel } from '../../../lib/kernel';

export type SubtitleSyncCapability =
  | { state: 'available'; explanation: '精细同步适用于当前已加载的外挂字幕。' }
  | { state: 'needs-external-subtitle'; explanation: '加载外挂字幕后可调整同步；内置字幕轨暂不支持此控件。' }
  | { state: 'unsupported-kernel'; explanation: '当前播放内核未提供可确认的外挂字幕同步能力。' };

/** Cue shifting is implemented for HTML5 and MPV external subtitles. */
export function subtitleSyncCapability(kernel: Kernel, externalSubtitleLoaded: boolean): SubtitleSyncCapability {
  if (kernel !== 'html5' && kernel !== 'mpv') {
    return { state: 'unsupported-kernel', explanation: '当前播放内核未提供可确认的外挂字幕同步能力。' };
  }
  if (!externalSubtitleLoaded) {
    return { state: 'needs-external-subtitle', explanation: '加载外挂字幕后可调整同步；内置字幕轨暂不支持此控件。' };
  }
  return { state: 'available', explanation: '精细同步适用于当前已加载的外挂字幕。' };
}
