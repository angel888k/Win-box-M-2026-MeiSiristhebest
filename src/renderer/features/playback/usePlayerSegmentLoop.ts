import { useCallback, useEffect, useRef, useState } from 'react';
import {
  EMPTY_PLAYER_SEGMENT_LOOP,
  isPlayerSegmentLoopActive,
  placePlayerSegmentPoint,
  shouldRepeatPlayerSegment,
  type PlayerSegmentLoop,
} from './application/playerSegmentLoop';

export interface PlayerSegmentLoopOptions {
  identity: string;
  currentTime: number;
  duration: number;
  available: boolean;
  seekTo: (time: number) => void;
  formatTime: (time: number) => string;
}

export function usePlayerSegmentLoop(options: PlayerSegmentLoopOptions) {
  const { identity, currentTime, duration, available, seekTo, formatTime } = options;
  const [stored, setStored] = useState<{ identity: string; loop: PlayerSegmentLoop }>(() => ({
    identity,
    loop: { ...EMPTY_PLAYER_SEGMENT_LOOP },
  }));
  const [open, setOpen] = useState(false);
  const repeatPending = useRef(false);
  const loop = stored.identity === identity ? stored.loop : EMPTY_PLAYER_SEGMENT_LOOP;
  const active = available && isPlayerSegmentLoopActive(loop);

  if (stored.identity !== identity) {
    setStored({ identity, loop: { ...EMPTY_PLAYER_SEGMENT_LOOP } });
    setOpen(false);
  }

  useEffect(() => {
    repeatPending.current = false;
  }, [identity, loop.start, loop.end]);

  useEffect(() => {
    if (!active) {
      repeatPending.current = false;
      return;
    }
    if (currentTime < (loop.end as number) - 0.5) repeatPending.current = false;
    if (!repeatPending.current && shouldRepeatPlayerSegment(currentTime, loop)) {
      repeatPending.current = true;
      seekTo(loop.start as number);
    }
  }, [active, currentTime, loop, seekTo]);

  const setPoint = useCallback((point: 'start' | 'end') => {
    if (!available) return false;
    const next = placePlayerSegmentPoint(loop, point, currentTime, duration);
    if (!next) return false;
    setStored({ identity, loop: next });
    return true;
  }, [available, currentTime, duration, identity, loop]);

  const clear = useCallback(() => {
    setStored({ identity, loop: { ...EMPTY_PLAYER_SEGMENT_LOOP } });
    repeatPending.current = false;
  }, [identity]);

  const model = {
    available,
    active,
    open,
    start: loop.start,
    end: loop.end,
    currentTime,
    formatTime,
    onToggle: () => setOpen(value => !value),
    onClose: () => setOpen(false),
    onSetStart: () => setPoint('start'),
    onSetEnd: () => setPoint('end'),
    onClear: clear,
  };

  return { model };
}
