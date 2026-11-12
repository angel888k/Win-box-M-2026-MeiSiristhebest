import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  progressHoverOffset,
  progressTimeAtPointer,
  projectProgressMarkers,
  projectProgressPercentages,
  type ProgressTrackBounds,
} from './application/playerProgressGeometry';
import type { PointerCoordinates, PlayerProgressBarModel } from './presentation/PlayerControlModels';

export interface ProgressPointerSample {
  clientX: number;
  bounds: ProgressTrackBounds;
}

export interface ProgressPointerDownSample extends ProgressPointerSample {
  button: number;
}

export interface ProgressHover {
  x: number;
  time: number;
  label: string;
}

/** Owns progress interaction state; the view adapts DOM events and measurements into samples. */
export function usePlayerProgressBarPresenter(model: PlayerProgressBarModel) {
  const latest = useRef(model);
  useLayoutEffect(() => {
    latest.current = model;
  });
  const seeking = useRef(false);
  const [hover, setHover] = useState<ProgressHover | null>(null);
  const [undo, setUndo] = useState<{ from: number; label: string } | null>(null);
  const pendingSeek = useRef<{ from: number; to: number } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const identity = useRef(model.identity);

  const clearUndo = useCallback(() => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    setUndo(null);
  }, []);

  const offerUndo = useCallback((from: number, to: number, threshold = 2) => {
    if (!Number.isFinite(from) || !Number.isFinite(to) || Math.abs(to - from) < threshold) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo({ from, label: latest.current.formatTime(from) });
    undoTimer.current = setTimeout(() => {
      undoTimer.current = null;
      setUndo(null);
    }, 5000);
  }, []);

  useLayoutEffect(() => {
    if (identity.current === model.identity) return;
    identity.current = model.identity;
    // A pointer capture may continue delivering events after the media changes.
    // End the old drag before the new identity can receive any further seeks.
    seeking.current = false;
    pendingSeek.current = null;
    setHover(null);
    clearUndo();
  }, [clearUndo, model.identity]);

  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = null;
  }, []);

  const timeAtPointer = useCallback(({ clientX, bounds }: ProgressPointerSample): number | null => (
    progressTimeAtPointer(clientX, bounds, latest.current.duration)
  ), []);

  const seekAtPointer = useCallback((sample: ProgressPointerSample) => {
    const time = timeAtPointer(sample);
    const state = latest.current;
    if (time == null || !state.canSeek()) return;
    state.seekTo(time);
  }, [timeAtPointer]);

  const updateHover = useCallback((sample: ProgressPointerSample) => {
    const time = timeAtPointer(sample);
    const x = progressHoverOffset(sample.clientX, sample.bounds);
    setHover(x == null || time == null ? null : { x, time, label: latest.current.formatTime(time) });
  }, [timeAtPointer]);

  const onPointerDown = useCallback((sample: ProgressPointerDownSample): boolean => {
    if (sample.button !== 0) return false;
    const state = latest.current;
    const time = timeAtPointer(sample);
    if (time == null || !state.canSeek()) return false;
    const from = state.getCurrentTime();
    pendingSeek.current = Number.isFinite(from) ? { from, to: time } : null;
    seeking.current = true;
    updateHover(sample);
    seekAtPointer(sample);
    return true;
  }, [seekAtPointer, timeAtPointer, updateHover]);

  const onPointerMove = useCallback((sample: ProgressPointerSample) => {
    updateHover(sample);
    if (seeking.current) {
      const time = timeAtPointer(sample);
      if (time != null && pendingSeek.current) pendingSeek.current.to = time;
      seekAtPointer(sample);
    }
  }, [seekAtPointer, timeAtPointer, updateHover]);

  const onPointerUp = useCallback((): boolean => {
    const wasSeeking = seeking.current;
    seeking.current = false;
    const pending = pendingSeek.current;
    pendingSeek.current = null;
    if (wasSeeking && pending) offerUndo(pending.from, pending.to);
    return wasSeeking;
  }, [offerUndo]);

  const onPointerCancel = useCallback(() => {
    seeking.current = false;
    pendingSeek.current = null;
  }, []);

  const onPointerLeave = useCallback(() => {
    if (!seeking.current) setHover(null);
  }, []);

  const onWheel = useCallback((deltaY: number) => {
    const state = latest.current;
    if (!state.duration || !state.canSeek()) return;
    const from = state.getCurrentTime();
    const next = Math.min(state.duration, Math.max(0, Math.round(from) + (deltaY < 0 ? 1 : -1)));
    state.seekTo(next);
    offerUndo(from, next, 0.5);
  }, [offerUndo]);

  const onKeyDown = useCallback((key: string, shiftKey = false): boolean => {
    const state = latest.current;
    if (!state.canSeek() || !Number.isFinite(state.duration) || state.duration <= 0) return false;
    const sampledTime = state.getCurrentTime();
    const from = Number.isFinite(sampledTime) ? sampledTime : state.currentTime;
    const step = shiftKey ? 30 : 5;
    let next: number;
    switch (key) {
      case 'ArrowLeft': next = from - step; break;
      case 'ArrowRight': next = from + step; break;
      case 'PageDown': next = from - 60; break;
      case 'PageUp': next = from + 60; break;
      case 'Home': next = 0; break;
      case 'End': next = state.duration; break;
      default: return false;
    }
    next = Math.max(0, Math.min(state.duration, next));
    if (next === from) return false;
    state.seekTo(next);
    offerUndo(from, next);
    return true;
  }, [offerUndo]);

  const onUndo = useCallback(() => {
    if (!undo || !latest.current.canSeek()) return;
    latest.current.seekTo(undo.from);
    clearUndo();
  }, [clearUndo, undo]);

  const selectChapter = useCallback((time: number) => {
    const state = latest.current;
    if (!state.canSeek() || !Number.isFinite(time) || !Number.isFinite(state.duration) || state.duration <= 0) return;
    const sampledTime = state.getCurrentTime();
    const from = Number.isFinite(sampledTime) ? sampledTime : state.currentTime;
    const target = Math.max(0, Math.min(state.duration, time));
    if (!Number.isFinite(from) || Math.abs(target - from) < 0.5) return;
    state.seekTo(target);
    offerUndo(from, target, 0.5);
  }, [offerUndo]);

  const onContextMenu = useCallback((position: PointerCoordinates, sample: ProgressPointerSample): boolean => {
    const handled = latest.current.onContextMenu(position, timeAtPointer(sample));
    if (handled) setHover(null);
    return handled;
  }, [timeAtPointer]);

  return {
    progress: projectProgressPercentages(model.currentTime, model.buffered, model.duration),
    markers: projectProgressMarkers(model.markers ?? [], model.duration),
    hover,
    undo,
    onUndo,
    selectChapter,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onPointerLeave,
    onWheel,
    onKeyDown,
    onContextMenu,
  };
}
