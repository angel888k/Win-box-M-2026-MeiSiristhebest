import { describe, expect, it } from 'vitest';
import { classifyPlaybackFailure, playbackFailureSummary } from '../src/shared/playbackFailure';

describe('playback failure classification', () => {
  it('distinguishes a connected media source that never presents its first frame', () => {
    const failure = classifyPlaybackFailure({ engine: 'html5', code: 'first-frame-timeout' });
    expect(failure).toMatchObject({ stage: 'startup', retryable: true });
    expect(playbackFailureSummary(failure)).toContain('没有产生首帧');
  });

  it('separates access denial, expired media, network errors, demux and decode failures', () => {
    expect(classifyPlaybackFailure({ engine: 'hls.js', httpStatus: 403 })).toMatchObject({ stage: 'authorization', retryable: false });
    expect(classifyPlaybackFailure({ engine: 'hls.js', reason: 'HTTP 404 Not Found' })).toMatchObject({ stage: 'missing-media', httpStatus: 404, retryable: false });
    expect(classifyPlaybackFailure({ engine: 'html5', mediaErrorCode: 2 })).toMatchObject({ stage: 'network', retryable: true });
    expect(classifyPlaybackFailure({ engine: 'html5', mediaErrorCode: 4 })).toMatchObject({ stage: 'demux', retryable: false });
    expect(classifyPlaybackFailure({ engine: 'html5', mediaErrorCode: 3 })).toMatchObject({ stage: 'decode', retryable: false });
  });

  it('retains only bounded machine codes and gives the user a plain-language explanation', () => {
    const failure = classifyPlaybackFailure({
      engine: 'hls.js',
      reason: 'HTTP 403 https://example.invalid/video?token=secret',
      code: 'fragLoadError',
    });

    expect(failure).toMatchObject({ stage: 'authorization', engine: 'hls.js', code: 'fragLoadError' });
    expect(JSON.stringify(failure)).not.toContain('secret');
    expect(playbackFailureSummary(failure)).toContain('访问权限');
  });
});
