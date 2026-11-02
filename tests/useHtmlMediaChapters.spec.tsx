// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useHtmlMediaChapters } from '../src/renderer/features/playback/useHtmlMediaChapters';

afterEach(cleanup);

describe('useHtmlMediaChapters', () => {
  it('reads browser-reported chapters and clears them when media identity changes', () => {
    const video = document.createElement('video');
    const tracks = new EventTarget() as TextTrackList;
    const chapterTrack = { kind: 'chapters', cues: [{ startTime: 12, text: 'Scene One' }] } as unknown as TextTrack;
    Object.defineProperty(tracks, 'length', { configurable: true, value: 1 });
    Object.defineProperty(tracks, '0', { configurable: true, value: chapterTrack });
    Object.defineProperty(video, 'textTracks', { configurable: true, value: tracks });
    const ref = { current: video };
    const { result, rerender } = renderHook(
      ({ identity, enabled }: { identity: string; enabled: boolean }) => useHtmlMediaChapters(ref, identity, enabled),
      { initialProps: { identity: 'episode-one', enabled: true } },
    );

    expect(result.current).toEqual([{ id: 'html-0-0', title: 'Scene One', startSeconds: 12 }]);
    act(() => rerender({ identity: 'episode-two', enabled: true }));
    expect(result.current).toBeNull();
    act(() => video.dispatchEvent(new Event('loadedmetadata')));
    expect(result.current).toEqual([{ id: 'html-0-0', title: 'Scene One', startSeconds: 12 }]);
  });

  it('keeps chapter state unknown when HTML5 chapter tracks are unavailable', () => {
    const video = document.createElement('video');
    Object.defineProperty(video, 'textTracks', { configurable: true, value: new EventTarget() });
    const ref = { current: video };
    const { result } = renderHook(() => useHtmlMediaChapters(ref, 'episode', true));
    expect(result.current).toBeNull();
  });
});
