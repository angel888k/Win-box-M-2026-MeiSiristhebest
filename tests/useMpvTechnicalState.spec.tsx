// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { emptyMpvKernelState } from '../src/shared/player';
import { useMpvTechnicalState } from '../src/renderer/features/playback/useMpvTechnicalState';

describe('useMpvTechnicalState chapter adapter', () => {
  it('exposes chapter-only MPV state changes without requiring time-axis wiring', () => {
    const { result } = renderHook(() => useMpvTechnicalState('https://media.example/movie.mkv', 'mpv'));
    const first = { id: 'mpv-0', title: 'Opening', startSeconds: 0 };
    const second = { id: 'mpv-1', title: 'Finale', startSeconds: 820 };
    act(() => result.current.onState({ ...emptyMpvKernelState(), loaded: true, chapters: [first] }));
    expect(result.current.chapters).toEqual([first]);
    act(() => result.current.onState({ ...emptyMpvKernelState(), loaded: true, chapters: [first, second] }));
    expect(result.current.chapters).toEqual([first, second]);
  });
});
