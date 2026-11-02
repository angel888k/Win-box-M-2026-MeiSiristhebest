import type { PlayerCapabilitySummary } from './application/playerCapabilitySummary';

const READINESS_LABEL: Record<PlayerCapabilitySummary['readiness'], string> = {
  ready: '已就绪',
  'not-ready': '未就绪',
  unknown: '就绪状态未知',
};

/** Passive disclosure of declared engine support and the current session observations. */
export function PlayerCapabilitySummaryView({ summary, onClose }: { summary: PlayerCapabilitySummary; onClose: () => void }) {
  return (
    <section className="vp-capability-summary" aria-labelledby="vp-capability-summary-title">
      <header className="vp-capability-summary__header">
        <h2 id="vp-capability-summary-title">当前播放器能力</h2>
        <span className="vp-capability-summary__readiness" data-state={summary.readiness} role="status" aria-live="polite">
          {summary.engineLabel} · {READINESS_LABEL[summary.readiness]}
        </span>
        <button type="button" className="vp-inf-x" title="关闭能力面板" aria-label="关闭能力面板" onClick={onClose}>×</button>
      </header>
      <dl className="vp-capability-summary__rows">
        {summary.rows.map(row => (
          <div key={row.id} className="vp-capability-summary__row" data-state={row.state}>
            <dt>{row.label}</dt>
            <dd>
              <span className="vp-capability-summary__state">{row.statusLabel}</span>
              <span className="vp-capability-summary__detail">{row.detail}</span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="vp-capability-summary__note">
        能力声明表示引擎报告的接口支持；实际媒体和渲染效果仍以本次播放反馈为准。
      </p>
    </section>
  );
}
