import type { PlayerProgressBarModel } from './presentation/PlayerControlModels';
import { useEffect, useRef, type PointerEvent } from 'react';
import { usePlayerProgressBarPresenter } from './usePlayerProgressBarPresenter';

type PlayerProgressBarProps = PlayerProgressBarModel;

export function PlayerProgressBar({
  identity,
  currentTime,
  duration,
  buffered,
  canSeek,
  getCurrentTime,
  seekTo,
  formatTime,
  onContextMenu,
}: PlayerProgressBarProps) {
  const progressRef = useRef<HTMLDivElement>(null);
  const presenter = usePlayerProgressBarPresenter({ identity, currentTime, duration, buffered, canSeek, getCurrentTime, seekTo, formatTime, onContextMenu });
  const onWheelSeek = presenter.onWheel;
  const readBounds = (element: HTMLDivElement) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, width: rect.width };
  };

  useEffect(() => {
    const element = progressRef.current;
    if (!element) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      onWheelSeek(event.deltaY);
    };
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, [onWheelSeek]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const started = presenter.onPointerDown({ button: event.button, clientX: event.clientX, bounds: readBounds(event.currentTarget) });
    if (!started) return;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Ignore unavailable pointer capture. */ }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    presenter.onPointerMove({ clientX: event.clientX, bounds: readBounds(event.currentTarget) });
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!presenter.onPointerUp()) return;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* Ignore unavailable pointer capture. */ }
  };

  return (
    <div
      ref={progressRef}
      className="vp-progress"
      style={{ cursor: 'pointer' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={presenter.onPointerCancel}
      onPointerLeave={presenter.onPointerLeave}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        presenter.onContextMenu(
          { clientX: event.clientX, clientY: event.clientY },
          { clientX: event.clientX, bounds: readBounds(event.currentTarget) },
        );
      }}
    >
      <div className="vp-buffer" style={{ width: `${presenter.progress.buffered}%` }} />
      <div className="vp-played" style={{ width: `${presenter.progress.played}%` }} />
      {presenter.hover && (
        <>
          <div className="vp-hline" style={{ left: presenter.hover.x }} />
          <div className="vp-htip" style={{ left: presenter.hover.x }}>{presenter.hover.label}</div>
        </>
      )}
      {presenter.undo && (
        <button
          type="button"
          className="vp-seek-undo"
          aria-label={`撤销跳转，回到 ${presenter.undo.label}`}
          disabled={!canSeek()}
          onPointerDown={event => event.stopPropagation()}
          onClick={presenter.onUndo}
        >
          撤销跳转 · {presenter.undo.label}
        </button>
      )}
      <div className="vp-thumb" style={{ left: `${presenter.progress.played}%` }} />
    </div>
  );
}
