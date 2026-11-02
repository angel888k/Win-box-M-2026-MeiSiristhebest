import { describe, expect, it } from 'vitest';
import {
  EMPTY_PLAYER_SEGMENT_LOOP,
  isPlayerSegmentLoopActive,
  placePlayerSegmentPoint,
  shouldRepeatPlayerSegment,
} from '../src/renderer/features/playback/application/playerSegmentLoop';

describe('player segment-loop policy', () => {
  it('requires A before B and rejects intervals shorter than one second', () => {
    expect(placePlayerSegmentPoint(EMPTY_PLAYER_SEGMENT_LOOP, 'end', 12, 100)).toBeNull();
    const start = placePlayerSegmentPoint(EMPTY_PLAYER_SEGMENT_LOOP, 'start', 10, 100)!;
    expect(placePlayerSegmentPoint(start, 'end', 10.9, 100)).toBeNull();
    expect(placePlayerSegmentPoint(start, 'end', 11, 100)).toEqual({ start: 10, end: 11 });
  });

  it('clears B when A is moved and clamps both points to the media duration', () => {
    const loop = placePlayerSegmentPoint({ start: 2, end: 8 }, 'start', 12, 10);
    expect(loop).toEqual({ start: 10, end: null });
    expect(isPlayerSegmentLoopActive(loop!)).toBe(false);
  });

  it('requests a repeat only near or beyond the valid end point', () => {
    const loop = { start: 25, end: 40 };
    expect(shouldRepeatPlayerSegment(39.7, loop)).toBe(false);
    expect(shouldRepeatPlayerSegment(39.85, loop)).toBe(true);
    expect(shouldRepeatPlayerSegment(2, { start: 25, end: null })).toBe(false);
  });
});
