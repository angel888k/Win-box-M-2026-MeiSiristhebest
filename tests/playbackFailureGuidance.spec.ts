import { describe, expect, it } from 'vitest';
import {
  classifyPlaybackFailure,
  playbackFailureNextStep,
  playbackFailureStageLabel,
} from '../src/shared/playbackFailure';

describe('playback failure recovery guidance', () => {
  it('suggests checking source authorization instead of retrying a denied request blindly', () => {
    const failure = classifyPlaybackFailure({ engine: 'hls.js', reason: 'HTTP 403 Forbidden' });

    expect(playbackFailureStageLabel(failure.stage)).toBe('访问权限');
    expect(playbackFailureNextStep(failure)).toContain('Cookie');
    expect(playbackFailureNextStep(failure)).toContain('同集其他来源');
  });

  it('distinguishes expired media links, network interruptions and decode failures', () => {
    const missing = classifyPlaybackFailure({ engine: 'hls.js', httpStatus: 404 });
    const network = classifyPlaybackFailure({ engine: 'html5', reason: 'network timeout' });
    const decode = classifyPlaybackFailure({ engine: 'html5', mediaErrorCode: 3 });

    expect(playbackFailureNextStep(missing)).toContain('重新解析当前集');
    expect(playbackFailureNextStep(network)).toContain('重试一次');
    expect(playbackFailureNextStep(decode)).toContain('MPV');
  });

  it('does not invent a cause when no engine diagnostic is available', () => {
    const unknown = classifyPlaybackFailure({ engine: 'unknown', reason: '播放失败' });

    expect(playbackFailureStageLabel(unknown.stage)).toBe('暂无法确认');
    expect(playbackFailureNextStep(unknown)).toContain('没有足够的内核信息');
  });
});
