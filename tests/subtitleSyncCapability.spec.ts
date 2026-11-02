import { describe, expect, it } from 'vitest';
import { subtitleSyncCapability } from '../src/renderer/features/playback/application/subtitleSyncCapability';

describe('subtitleSyncCapability', () => {
  it('enables cue shifting only for a loaded external subtitle on a supported built-in kernel', () => {
    expect(subtitleSyncCapability('html5', true).state).toBe('available');
    expect(subtitleSyncCapability('mpv', true).state).toBe('available');
    expect(subtitleSyncCapability('html5', false).state).toBe('needs-external-subtitle');
  });

  it('keeps plugin kernels unsupported instead of inferring capability from subtitle presence', () => {
    expect(subtitleSyncCapability('engine:custom', true)).toEqual({
      state: 'unsupported-kernel',
      explanation: '当前播放内核未提供可确认的外挂字幕同步能力。',
    });
  });
});
