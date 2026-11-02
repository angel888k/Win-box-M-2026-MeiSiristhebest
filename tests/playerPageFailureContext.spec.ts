import { describe, expect, it } from 'vitest';
import {
  initialPlayerPageSessionState,
  presentPlayerPageSession,
  reducePlayerPageSession,
} from '../src/renderer/features/playback/application/playerPageSessionState';

describe('player page failure context', () => {
  it('retains sanitized engine facts for the in-player recovery view', () => {
    const failure = {
      stage: 'authorization' as const,
      engine: 'hls.js' as const,
      httpStatus: 403,
      retryable: false,
    };
    const reported = reducePlayerPageSession(initialPlayerPageSessionState, {
      type: 'playback-failure-reported',
      failure,
    });

    expect(presentPlayerPageSession(reported).playbackFailure).toEqual(failure);
    expect(reducePlayerPageSession(reported, { type: 'source-fallback-cleared' }).playbackFailure).toBeUndefined();
  });
});
