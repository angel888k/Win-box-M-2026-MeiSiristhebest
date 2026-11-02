// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { usePlayerSegmentLoop } from '../src/renderer/features/playback/usePlayerSegmentLoop';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('usePlayerSegmentLoop', () => {
  it('loops to A when playback reaches B and resets points when the media changes', () => {
    const seekTo = vi.fn();
    const formatTime = (seconds: number) => `${Math.floor(seconds)}s`;
    const { result, rerender } = renderHook(
      ({ identity, currentTime }: { identity: string; currentTime: number }) => usePlayerSegmentLoop({
        identity, currentTime, duration: 100, available: true, seekTo, formatTime,
      }),
      { initialProps: { identity: 'work-episode-1', currentTime: 10 } },
    );

    act(() => { result.current.model.onSetStart(); });
    expect(result.current.model.start).toBe(10);
    expect(result.current.model.onSetEnd()).toBe(false);
    rerender({ identity: 'work-episode-1', currentTime: 20 });
    act(() => { result.current.model.onSetEnd(); });
    expect(result.current.model.active).toBe(true);

    rerender({ identity: 'work-episode-1', currentTime: 19.9 });
    expect(seekTo).toHaveBeenCalledWith(10);

    rerender({ identity: 'work-episode-2', currentTime: 5 });
    expect(result.current.model.start).toBeNull();
    expect(result.current.model.end).toBeNull();
    expect(result.current.model.active).toBe(false);
  });

  it('does not keep an active loop when seeking is unavailable', () => {
    const seekTo = vi.fn();
    const { result } = renderHook(() => usePlayerSegmentLoop({
      identity: 'live', currentTime: 90, duration: 100, available: false, seekTo, formatTime: String,
    }));

    expect(result.current.model.active).toBe(false);
    expect(result.current.model.onSetStart()).toBe(false);
    expect(seekTo).not.toHaveBeenCalled();
  });
});
