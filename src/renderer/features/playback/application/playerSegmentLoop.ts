export interface PlayerSegmentLoop {
  start: number | null;
  end: number | null;
}

export const EMPTY_PLAYER_SEGMENT_LOOP: Readonly<PlayerSegmentLoop> = Object.freeze({ start: null, end: null });
export const MIN_PLAYER_SEGMENT_SECONDS = 1;

export function placePlayerSegmentPoint(
  loop: PlayerSegmentLoop,
  point: 'start' | 'end',
  currentTime: number,
  duration: number,
): PlayerSegmentLoop | null {
  if (!Number.isFinite(currentTime) || !Number.isFinite(duration) || duration <= 0) return null;
  const time = Math.max(0, Math.min(duration, currentTime));
  if (point === 'start') return { start: time, end: null };
  if (loop.start == null || time - loop.start < MIN_PLAYER_SEGMENT_SECONDS) return null;
  return { start: loop.start, end: time };
}

export function isPlayerSegmentLoopActive(loop: PlayerSegmentLoop): boolean {
  return loop.start != null && loop.end != null
    && Number.isFinite(loop.start) && Number.isFinite(loop.end)
    && loop.start >= 0 && loop.end - loop.start >= MIN_PLAYER_SEGMENT_SECONDS;
}

export function shouldRepeatPlayerSegment(
  currentTime: number,
  loop: PlayerSegmentLoop,
  endTolerance = 0.15,
): boolean {
  return isPlayerSegmentLoopActive(loop)
    && Number.isFinite(currentTime)
    && currentTime >= (loop.end as number) - Math.max(0, endTolerance);
}
