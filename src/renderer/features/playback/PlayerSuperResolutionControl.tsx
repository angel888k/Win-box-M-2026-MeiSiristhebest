import type { SuperResolutionControlModel } from './presentation/PlayerControlModels';
import { SR_MODE_LABEL, type SrMode } from '../../../shared/player';
import { usePlayerPanelPosition } from '../../lib/usePlayerPanelPosition';
import { usePlaybackPopupKeyboard } from './usePlaybackPopupKeyboard';
import { formatSuperResolutionRenderStatus } from './presentation/superResolutionFeedback';

type PlayerSuperResolutionControlProps = SuperResolutionControlModel;

export function PlayerSuperResolutionControl({ visible, active, mpvStatusResolved, mpvAvailable, capabilityLoading, capabilityError, info, mode, feedback, renderStatus, renderStatusLoading, renderStatusError, open, containerRef, onOpen, onClose, onSwitchToMpv, onSelect }: PlayerSuperResolutionControlProps) {
  const panelRef = usePlayerPanelPosition(open, containerRef);
  const { triggerRef, panelId, onKeyDown, onPointerLeave, onBlur } = usePlaybackPopupKeyboard(open, onOpen, onClose);
  if (!visible) return null;
  const available = active && info?.available === true;
  const modes = info?.modes ?? [];
  const labelForMode = (id: SrMode) => id === 'off'
    ? SR_MODE_LABEL.off
    : modes.find(item => item.id === id)?.label ?? SR_MODE_LABEL[id] ?? id;
  const title = !active
    ? '超分通过 MPV GPU 着色器处理；点击查看如何启用。'
    : capabilityLoading
      ? '正在检查超分插件…'
      : capabilityError
        ? `读取超分插件状态失败：${capabilityError}`
        : info?.available
          ? mode === 'off' ? '超分已关闭（MPV GPU 着色器）' : `已选超分档位：${SR_MODE_LABEL[mode] ?? mode}；渲染状态请看面板`
          : '超分着色器插件未就绪；点击查看诊断信息。';
  const statusText = feedback?.message ?? (mode === 'off'
    ? '当前关闭。选择档位后会向 MPV 发送着色器链。'
    : `已选择「${labelForMode(mode)}」。新播放会在起播时加载，当前播放会即时更新。`);
  return (
    <div className="vp-vol" onPointerEnter={available ? onOpen : undefined} onPointerLeave={onPointerLeave} onBlur={onBlur}>
      <button ref={triggerRef} type="button" className={'vp-ctl vp-kernel' + (available && mode !== 'off' ? ' vp-on' : '')} title={title} aria-label="超分辨率" aria-pressed={available && mode !== 'off'} aria-expanded={open} aria-controls={panelId} aria-keyshortcuts="ArrowDown" onKeyDown={onKeyDown} onClick={onOpen}><span className="vp-kernel-tag">超分</span></button>
      {open && <div className={'vp-fithost' + (open ? ' open' : '')}>
        <div ref={panelRef} id={panelId} className="vp-subpanel vp-fitpanel vp-audiopanel">
          <div className="vsp-row"><span className="muted">MPV GPU 超分</span></div>
          <p className="vsp-hint" style={{ display: 'block' }}>通过 MPV 的 GPU 着色器实时放大画面。支持内置 MPV；HTML5 与 PotPlayer 不接收这组着色器。</p>
          {!active ? (
            <div className="vsp-hint" role="status" style={{ display: 'block' }}>
              <p>当前播放内核不是 MPV，超分尚未生效。</p>
              {!mpvStatusResolved
                ? <p>正在检测 MPV 播放内核…</p>
                : mpvAvailable
                  ? <button type="button" className="vsp-btn active" onClick={onSwitchToMpv}>切换到 MPV 内核</button>
                  : <p>这台设备暂时没有可用的 MPV 内核。请先在设置中安装或启用 MPV 播放组件。</p>}
            </div>
          ) : capabilityLoading ? (
            <output className="vsp-hint" role="status" style={{ display: 'block' }}>正在检查插件…</output>
          ) : capabilityError ? (
            <output className="vsp-hint err" role="alert" style={{ display: 'block' }}>超分插件未就绪：{capabilityError}</output>
          ) : !info?.available ? (
            <div className="vsp-hint" role="status" style={{ display: 'block' }}>
              <p>未检测到着色器插件</p>
            </div>
          ) : <>
            <div className="vsp-fits">{['off', ...modes.map(item => item.id)].map(value => {
              const id = value as SrMode;
              return <button key={id} type="button" className={'vsp-btn' + (mode === id ? ' active' : '')} aria-pressed={mode === id} onClick={() => onSelect(id)}>{labelForMode(id)}</button>;
            })}</div>
            {feedback?.kind === 'error' && <output className="vsp-hint err" aria-live="polite" style={{ display: 'block' }}>{feedback.message}</output>}
            {renderStatusLoading && <output className="vsp-hint" role="status" style={{ display: 'block' }}>正在读取渲染状态…</output>}
            {renderStatusError && <output className="vsp-hint err" role="alert" style={{ display: 'block' }}>读取 MPV 渲染状态失败：{renderStatusError}</output>}
            {renderStatus && <output className="vsp-hint" role="status" style={{ display: 'block' }}>{formatSuperResolutionRenderStatus(renderStatus)}</output>}
          </>}
        </div>
      </div>}
    </div>
  );
}
