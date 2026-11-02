import { useId, useRef } from 'react';
import type { PlayerSegmentLoopControlModel } from './presentation/PlayerControlModels';

export function PlayerSegmentLoopControl(model: PlayerSegmentLoopControlModel) {
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const canSetEnd = model.start != null && model.currentTime - model.start >= 1;

  return (
    <>
      <button
        type="button"
        className={'vp-ctl' + (model.active ? ' vp-on' : '')}
        aria-label="片段循环 A-B"
        aria-expanded={model.open}
        aria-controls={model.open ? panelId : undefined}
        aria-pressed={model.active}
        ref={triggerRef}
        title={model.active ? `正在循环 ${model.formatTime(model.start!)}–${model.formatTime(model.end!)}` : '片段循环 A-B'}
        disabled={!model.available}
        onClick={model.onToggle}
        onKeyDown={event => {
          if (model.open && event.key === 'Escape') {
            event.preventDefault();
            model.onClose();
          }
        }}
      >
        <span aria-hidden="true" className="vp-segment-mark">A↔B</span>
        {model.active && <span className="vp-subdot" />}
      </button>
      {model.open && model.available && (
        <section
          id={panelId}
          className="vp-subpanel vp-skippanel vp-segment-panel"
          role="dialog"
          aria-label="片段循环"
          onPointerDown={event => event.stopPropagation()}
          onDoubleClick={event => event.stopPropagation()}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault();
              model.onClose();
              triggerRef.current?.focus();
            }
          }}
        >
          <div className="vsp-row vp-segment-heading">
            <strong>片段循环</strong>
            <span className="muted" aria-live="polite">{model.active ? '正在循环' : model.start == null ? '未设置片段' : '等待设置 B 点'}</span>
          </div>
          <div className="vp-segment-points" aria-label="循环区间">
            <span className={model.start == null ? 'vp-segment-point muted' : 'vp-segment-point'}>
              <b>A</b>{model.start == null ? '未设置' : model.formatTime(model.start)}
            </span>
            <span aria-hidden="true" className="vp-segment-arrow">→</span>
            <span className={model.end == null ? 'vp-segment-point muted' : 'vp-segment-point'}>
              <b>B</b>{model.end == null ? '未设置' : model.formatTime(model.end)}
            </span>
          </div>
          <p className="vp-segment-hint">仅对当前集生效。设置 A 点后，播放到 B 点会自动回到 A 点。</p>
          <div className="vsp-row vp-segment-actions">
            <button type="button" className="vsp-btn" onClick={model.onSetStart}>设 A · {model.formatTime(model.currentTime)}</button>
            <button type="button" className="vsp-btn" disabled={!canSetEnd} onClick={model.onSetEnd}>设 B · {model.formatTime(model.currentTime)}</button>
            <button type="button" className="vsp-btn" disabled={model.start == null && model.end == null} onClick={model.onClear}>清除</button>
          </div>
        </section>
      )}
    </>
  );
}
