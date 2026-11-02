import { describe, expect, it } from 'vitest';
import {
  progressHoverOffset,
  progressTimeAtPointer,
  projectProgressMarkers,
  projectProgressPercentages,
} from '../src/renderer/features/playback/application/playerProgressGeometry';

describe('player progress geometry policy', () => {
  const bounds = { left: 10, width: 100 };

  it('maps pointer positions to rounded, duration-bounded seek times', () => {
    expect(progressTimeAtPointer(10, bounds, 61)).toBe(0);
    expect(progressTimeAtPointer(60, bounds, 61)).toBe(31);
    expect(progressTimeAtPointer(200, bounds, 61)).toBe(61);
  });

  it('rejects missing or non-finite geometry instead of seeking to NaN', () => {
    expect(progressTimeAtPointer(50, { left: 10, width: 0 }, 60)).toBeNull();
    expect(progressTimeAtPointer(50, bounds, 0)).toBeNull();
    expect(progressTimeAtPointer(Number.NaN, bounds, 60)).toBeNull();
    expect(progressTimeAtPointer(50, bounds, Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('keeps the hover hint in its thumb-safe inset and clamps CSS percentages', () => {
    expect(progressHoverOffset(10, bounds)).toBe(22);
    expect(progressHoverOffset(110, bounds)).toBe(78);
    expect(projectProgressPercentages(30, 75, 60)).toEqual({ played: 50, buffered: 100 });
    expect(projectProgressPercentages(Number.NaN, -1, 60)).toEqual({ played: 0, buffered: 0 });
    expect(projectProgressPercentages(15, 25, Number.POSITIVE_INFINITY)).toEqual({ played: 0, buffered: 0 });
  });

  it('projects intro and outro markers and drops invalid or out-of-range points', () => {
    const markers = [
      { id: 'intro', time: 30, kind: 'intro-end' as const, label: '片头结束' },
      { id: 'outro', time: 90, kind: 'outro-start' as const, label: '片尾开始' },
      { id: 'loop-start', time: 40, kind: 'segment-start' as const, label: '循环 A 点' },
      { id: 'loop-end', time: 60, kind: 'segment-end' as const, label: '循环 B 点' },
      { id: 'negative', time: -1, kind: 'intro-end' as const, label: '无效' },
      { id: 'past-end', time: 100, kind: 'outro-start' as const, label: '越界' },
      { id: 'nan', time: Number.NaN, kind: 'intro-end' as const, label: '无效' },
    ];
    expect(projectProgressMarkers(markers, 100).map(({ id, percent }) => ({ id, percent }))).toEqual([
      { id: 'intro', percent: 30 },
      { id: 'loop-start', percent: 40 },
      { id: 'loop-end', percent: 60 },
      { id: 'outro', percent: 90 },
    ]);
    expect(projectProgressMarkers(markers, 0)).toEqual([]);
  });
});
