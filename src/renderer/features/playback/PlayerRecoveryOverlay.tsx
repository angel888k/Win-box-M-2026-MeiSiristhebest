import { useState } from 'react';
import { classifyPlaybackFailure, playbackFailureNextStep, playbackFailureStageLabel, playbackFailureSummary } from '../../../shared/playbackFailure';
import type { PlaybackFailureContext } from '../../../shared/playbackFailure';
import { redactPlaybackDiagnosticMessage } from './application/playerDiagnostic';
import type { PlayerDiagnosticRecord } from './application/playerDiagnosticHistory';
import type { PlayerSourceFallbackState } from './application/playerPageSessionState';

export interface PlayerRecoveryOverlayProps {
  fallback: PlayerSourceFallbackState;
  placement?: 'video' | 'stage';
  parseError: string;
  canRetryCurrent: boolean;
  canSearchAgain: boolean;
  canGoPrevious: boolean;
  canGoNext: boolean;
  showEpisodeNavigation: boolean;
  onSelectAlternative(id: string, currentPosition?: number): void;
  currentPosition?: number;
  onRetryCurrent(): void;
  onSearchAgain(): void;
  onPreviousEpisode(): void;
  onNextEpisode(): void;
  failure?: PlaybackFailureContext;
  onCopyDiagnostic?(message: string, failure?: PlaybackFailureContext): Promise<boolean>;
  diagnosticHistory?: readonly PlayerDiagnosticRecord[];
  onClearDiagnosticHistory?(): void;
}

/** Recovery feedback stays inside the video surface, beside the action it describes. */
export function PlayerRecoveryOverlay(props: PlayerRecoveryOverlayProps) {
  const {
    fallback, placement = 'video', parseError, canRetryCurrent, canSearchAgain, canGoPrevious, canGoNext,
    showEpisodeNavigation, onSelectAlternative, currentPosition, onRetryCurrent, onSearchAgain, onPreviousEpisode, onNextEpisode,
    onCopyDiagnostic, failure: reportedFailure, diagnosticHistory = [], onClearDiagnosticHistory,
  } = props;
  const message = fallback.kind === 'unavailable' ? fallback.message : parseError;
  const inProgress = fallback.kind === 'searching' || fallback.kind === 'switching';
  const failure = reportedFailure ?? classifyPlaybackFailure({ engine: 'unknown', reason: message });
  const safeMessage = redactPlaybackDiagnosticMessage(message);
  const safeFailureEngine = ['html5', 'hls.js', 'mpegts.js', 'mpv', 'external'].includes(String(failure.engine)) ? failure.engine : 'unknown';
  const safeFailureHttpStatus = Number.isInteger(failure.httpStatus) && failure.httpStatus! >= 100 && failure.httpStatus! <= 599 ? failure.httpStatus : undefined;
  const safeFailureCode = typeof failure.code === 'string' && /^[a-z0-9_.:-]{1,48}$/i.test(failure.code) ? failure.code : undefined;
  const diagnosticMessages = [...new Set([parseError, fallback.kind === 'unavailable' ? fallback.message : '']
    .map(value => redactPlaybackDiagnosticMessage(value))
    .filter(Boolean))];
  const diagnosticText = diagnosticMessages.join('\n\n');
  const hasDiagnostic = !inProgress && Boolean(message);
  const [copyFeedback, setCopyFeedback] = useState<{ text: string; copied: boolean } | null>(null);
  const currentCopyFeedback = copyFeedback?.text === diagnosticText ? copyFeedback : null;
  const heading = fallback.kind === 'searching'
    ? '正在寻找可用片源'
    : fallback.kind === 'switching'
      ? '正在切换片源'
      : fallback.kind === 'unavailable'
        ? '暂无可用的备用片源'
        : '播放失败';
  const candidates = fallback.kind === 'idle' ? [] : (fallback.candidates || []);
  const incompleteSources = fallback.kind === 'idle' ? 0 : (fallback.incompleteSources || 0);
  const candidateId = fallback.kind === 'switching' ? fallback.candidateId : undefined;

  return (
    <div className={`player-recovery-overlay player-recovery-overlay--${placement}`} data-recovery-state={fallback.kind} aria-busy={inProgress}>
      <section className="player-recovery-card" aria-label="播放状态与恢复操作">
        <div className="player-recovery-live" role={inProgress ? 'status' : 'alert'} aria-live={inProgress ? 'polite' : 'assertive'} aria-atomic="true">
          {inProgress && <span className="player-recovery-spinner" aria-hidden="true" />}
          <h2 className="player-recovery-title">{heading}</h2>
          {fallback.kind === 'searching' && <p className="player-recovery-message">正在匹配备用片源…</p>}
          {fallback.kind === 'switching' && <p className="player-recovery-message">{fallback.message || `正在尝试：${fallback.sourceName}`}</p>}
          {message && !inProgress && <p className="player-recovery-message">{safeMessage.length > 280 ? safeMessage.slice(0, 280) + '…' : safeMessage}</p>}
          {hasDiagnostic && (
            <>
              <details className="player-recovery-details">
                <summary>查看播放诊断</summary>
                <div className="player-recovery-diagnostic-summary">
                  <strong>故障阶段：{playbackFailureStageLabel(failure.stage)}</strong>
                  <span>{playbackFailureSummary(failure)}</span>
                  <span><b>建议操作：</b>{playbackFailureNextStep(failure)}</span>
                  <span><b>内核：</b>{safeFailureEngine === 'unknown' ? '未报告' : safeFailureEngine}</span>
                  <span><b>HTTP 状态：</b>{safeFailureHttpStatus ?? '未报告'}</span>
                  <span><b>错误码：</b>{safeFailureCode ?? '未报告'}</span>
                  <span><b>可重试：</b>{failure.retryable ? '是' : '未确认'}</span>
                </div>
                <pre>{diagnosticText}</pre>
                {onCopyDiagnostic && (
                  <div className="player-recovery-diagnostic-actions">
                    <button
                      type="button"
                      className="player-recovery-action"
                      onClick={() => {
                        void onCopyDiagnostic(diagnosticText, failure).then(copied => setCopyFeedback({ text: diagnosticText, copied }));
                      }}
                    >
                      {currentCopyFeedback ? (currentCopyFeedback.copied ? '已复制诊断摘要' : '重新复制诊断摘要') : '复制诊断摘要'}
                    </button>
                    <span role="status" aria-live="polite">
                      {currentCopyFeedback ? (currentCopyFeedback.copied ? '已隐藏链接和凭据。' : '复制失败，请稍后重试。') : ''}
                    </span>
                  </div>
                )}
                {diagnosticHistory.length > 0 && (
                  <section className="player-recovery-history" aria-label="最近播放故障记录">
                    <div className="player-recovery-history-heading">
                      <strong>最近播放故障</strong>
                      <span>{diagnosticHistory.length} 条 · 仅保存在本机</span>
                      {onClearDiagnosticHistory && (
                        <button type="button" className="player-recovery-history-clear" onClick={onClearDiagnosticHistory}>清除记录</button>
                      )}
                    </div>
                    <ol>
                      {diagnosticHistory.slice(0, 5).map((record, index) => (
                        <li key={`${record.recordedAt}-${index}`}>
                          <span className="player-recovery-history-time">{new Date(record.recordedAt).toLocaleString()}</span>
                          <strong>{record.title}</strong>
                          <span>{record.sourceName} · {playbackFailureStageLabel(record.failure.stage)}</span>
                          {record.failure.httpStatus && <span>HTTP {record.failure.httpStatus}</span>}
                          <p>{record.message || playbackFailureSummary(record.failure)}</p>
                        </li>
                      ))}
                    </ol>
                  </section>
                )}
              </details>
            </>
          )}
        </div>
        {candidates.length > 0 && (
          <section className="player-recovery-candidates" aria-label="匹配到的同剧同集来源">
            <div className="player-recovery-candidates-heading">
              <span>匹配到的同剧同集来源</span>
              <span className="player-recovery-candidates-count">{candidates.length}</span>
            </div>
            <div className="player-recovery-candidate-list">
              {candidates.map(candidate => {
                const isSwitching = candidate.id === candidateId;
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    className={`player-recovery-candidate${isSwitching ? ' is-switching' : ''}`}
                    aria-label={`${isSwitching ? '正在尝试播放' : '尝试播放'} ${candidate.sourceName}${candidate.profileName ? `，${candidate.profileName}` : ''}`}
                    aria-current={isSwitching ? 'true' : undefined}
                    aria-disabled={isSwitching}
                    onClick={() => { if (!isSwitching) onSelectAlternative(candidate.id, currentPosition); }}
                  >
                    <span className="player-recovery-candidate-name">
                      <strong>{candidate.sourceName}</strong>
                      {candidate.profileName && <small>{candidate.profileName}</small>}
                    </span>
                    <span className="player-recovery-candidate-action">{isSwitching ? '正在尝试播放' : '尝试播放'}</span>
                  </button>
                );
              })}
            </div>
            <p className="player-recovery-candidates-note">
              片名与集数匹配已确认，播放仍要等播放器实际连接后才能确认。
              {incompleteSources > 0 && ` 另有 ${incompleteSources} 个来源或影片详情未能完成核验，不代表它们不可播放。`}
              {fallback.kind !== 'idle' && fallback.searchIncomplete && ' 全源搜索达到时间上限，尚未全部完成。'}
              {fallback.kind !== 'idle' && fallback.truncated && ' 候选较多，仅核验了前几项。'}
            </p>
          </section>
        )}
        {(canRetryCurrent || canSearchAgain || (showEpisodeNavigation && (canGoPrevious || canGoNext))) && (
          <div className="player-recovery-actions">
            {showEpisodeNavigation && canGoPrevious && (
              <button type="button" className="player-recovery-action" onClick={onPreviousEpisode}>上一集</button>
            )}
            {showEpisodeNavigation && canGoNext && (
              <button type="button" className="player-recovery-action" onClick={onNextEpisode}>下一集</button>
            )}
            {canRetryCurrent && (
              <button type="button" className="player-recovery-action" onClick={onRetryCurrent}>重试当前来源</button>
            )}
            {canSearchAgain && (
              <button type="button" className="player-recovery-action player-recovery-action--primary" onClick={onSearchAgain}>重新搜索备用来源</button>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
