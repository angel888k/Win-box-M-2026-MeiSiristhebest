import VideoPlayer from '../components/VideoPlayer';
import TitleBarView from '../components/TitleBarView';
import { DriveBindingDialog } from '../features/driveBinding/DriveBindingDialog';
import { PlayerRecoveryOverlay } from '../features/playback/PlayerRecoveryOverlay';
import { playerWorkPreferenceKey } from '../features/playback/application/playerWorkPreferences';
import type { PlayerDiagnosticRecord } from '../features/playback/application/playerDiagnosticHistory';
import { historyGroupKey } from '../lib/uiHistoryMerge';
import type { PlayerPageSession } from '../features/playback/usePlayerPageSession';
import type { PlayerPageWindowState } from '../features/playback/usePlayerPageWindow';

type PlayerPageViewProps = {
  session: PlayerPageSession;
  windowState: PlayerPageWindowState;
  title: string;
  onResolutionChange(resolution: string): void;
  onCopyDiagnostic?(message: string): Promise<boolean>;
  diagnosticHistory?: readonly PlayerDiagnosticRecord[];
  onClearDiagnosticHistory?(): void;
};

export function PlayerPageView({ session, windowState, title, onResolutionChange, onCopyDiagnostic, diagnosticHistory, onClearDiagnosticHistory }: PlayerPageViewProps) {
  const {
    init, epIndex, activeUrl, curName, playName, resolving, driveBind, parseMsg, parseName,
    sourceFallback, playbackFailure, episodes, canPrev, canNext, selectEpisode, retryCurrent, autoChangeParse, retryAlternativeSearch,
    confirmPlaybackStarted, dismissDriveBinding, onDriveBound, prepareNextEpisode,
  } = session;
  const { appIcon, maximized, mini, pinTop, minimize, toggleMaximize, setMini, togglePinTop, close } = windowState;
  const eps = episodes;
  const workPreferenceKey = init && init.playbackKind !== 'live' && init.playbackKind !== 'live-catchup' && init.playbackKind !== 'storage'
    ? playerWorkPreferenceKey({
      title: init.subtitleTitle || init.title,
      sourceKey: init.meta?.fromKey || init.key,
      vodId: init.meta?.vodId || init.meta?.id,
      profileId: init.meta?.profileId,
    })
    : '';
  const hasRecoveryState = Boolean(parseMsg) || sourceFallback.kind !== 'idle';
  const fallbackInProgress = sourceFallback.kind === 'searching' || sourceFallback.kind === 'switching';
  const recoveryOverlay = hasRecoveryState ? (
    <PlayerRecoveryOverlay
      fallback={sourceFallback}
      failure={playbackFailure}
      placement={activeUrl ? 'video' : 'stage'}
      parseError={fallbackInProgress ? '' : parseMsg}
      canRetryCurrent={!fallbackInProgress}
      canSearchAgain={sourceFallback.kind === 'unavailable'}
      canGoPrevious={canPrev}
      canGoNext={canNext}
      showEpisodeNavigation={!activeUrl}
      onSelectAlternative={(id, pos) => {
        if (pos !== undefined) session.selectAlternative(id, pos);
        else session.selectAlternative(id);
      }}
      onRetryCurrent={retryCurrent}
      onSearchAgain={() => void retryAlternativeSearch()}
      onPreviousEpisode={() => selectEpisode(epIndex - 1)}
      onNextEpisode={() => selectEpisode(epIndex + 1)}
      onCopyDiagnostic={onCopyDiagnostic}
      diagnosticHistory={diagnosticHistory}
      onClearDiagnosticHistory={onClearDiagnosticHistory}
    />
  ) : null;

  return (
    <>
      {/* 小窗口模式使用 18px 拖拽条：拖动窗口、双击还原；文字常显，悬停只强调按钮 */}
      {mini ? (
        <div className="mini-strip" onDoubleClick={() => void setMini(false)}>
          <span className="mini-strip-title" title={title}>{title}</span>
          <div className="mini-strip-btns">
            {/* ★ 2026-10-08（用户要求）：置顶按钮在 mini 条上（与标题栏同款）；开启态 accent 高亮 */}
            <button
              className="mini-btn"
              style={pinTop ? { color: 'var(--accent)' } : undefined}
              title={pinTop ? '置顶：开（点击取消）' : '置顶：关（点击把窗口固定在最上层）'}
              aria-pressed={pinTop}
              onClick={togglePinTop}
            >
              {pinTop ? (
                <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="currentColor" d="M9.6 3h4.8l.7 6.1 3.1 3.1V14H5.8v-1.8l3.1-3.1L9.6 3Z" />
                  <path d="M12 14v6.6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9.6 3h4.8l.7 6.1 3.1 3.1V14H5.8v-1.8l3.1-3.1L9.6 3Z" />
                  <path d="M12 14v6.6" />
                </svg>
              )}
            </button>
            <button className="mini-btn" aria-label="恢复原窗口" title="恢复原窗口" onClick={() => void setMini(false)}>
              <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="2.5" y="2.5" width="11" height="11" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                <path d="M6.5 9.5V6.5h3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M6.5 6.5l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button className="mini-btn mini-strip-close" aria-label="关闭" title="关闭" onClick={() => void close()}>
              <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
                <line x1="4" y1="4" x2="12" y2="12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <line x1="12" y1="4" x2="4" y2="12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      ) : (
        <TitleBarView
          title={title}
          appIcon={appIcon}
          maximized={maximized}
          showMini
          mini={mini}
          onMiniToggle={() => void setMini(!mini)}
          showPin
          pinTop={pinTop}
          onPinToggle={togglePinTop}
          onMinimize={minimize}
          onMaximizeToggle={toggleMaximize}
          onClose={close}
        />
      )}
      {/* ★ 2026-09-26：这两层改用 CSS 类（`.pwin-body` / `.pwin-stage`）——内联样式没有
          `min-height: 0`，flex 的默认 `min-height: auto` 会被视频固有比例撑高，
          竖屏/超宽视频会把播放器整体顶出视口，底部控制条随之不可见（用户报的「下方 UI 消失」）。 */}
      <div className="pwin-body">
        {driveBind && (
          <DriveBindingDialog
            siteName={curName || '当前播放源'}
            initialProvider={driveBind}
            onClose={() => dismissDriveBinding()}
            onSaved={onDriveBound}
          />
        )}
        <div className={`pwin-stage${mini ? ' pwin-stage--mini' : ''}`}>
          {!activeUrl && recoveryOverlay}
          {activeUrl ? (
            <VideoPlayer
              url={activeUrl}
              statusOverlay={recoveryOverlay}
              suppressPlaybackFailure={hasRecoveryState}
              playbackSource={init ? { profileId: init.meta?.profileId, key: init.meta?.fromKey || init.key } : undefined}
              playbackKind={init?.playbackKind}
              fastRecovery={init?.fastRecovery}
              workPreferenceKey={workPreferenceKey}
              resourceName={curName}
              playTitle={playName}
              parseName={parseName}
              onAutoChangeParse={autoChangeParse}
              onPlaybackStarted={confirmPlaybackStarted}
              onPrepareNextEpisode={prepareNextEpisode}
              onRetryPlayback={retryCurrent}
              onResolutionChange={onResolutionChange}
              danmakuTitle={((init?.subtitleTitle || init?.title) || '').trim()}
              driveBindProvider={driveBind}
              // ★ 2026-09-29：在播放器里绑定网盘成功后自动重新解析当前集（不必手动重开播放窗口）
              onDriveBound={onDriveBound}
              // ★ 历史续播：进度以历史记录为准（新直链与 playTime 旧键不匹配，须显式传入）
              startTime={init?.startTime || 0}
              canPrev={canPrev}
              canNext={canNext}
              onPrev={() => selectEpisode(epIndex - 1)}
              onNext={() => selectEpisode(epIndex + 1)}
              mini={mini}
              onToggleMini={() => void setMini(!mini)}
              // ★ 2026-10-08（用户拍板「内置官方构建」）：MPV 高兼容内核 —— 仅本窗口（transparent）可用
              allowMpv
              // ★ 2026-09-30：图集源（每「集」= 一张图）/ 音乐源 → 图片浏览器 / 音乐播放器显示页码与封面
              epIndex={epIndex}
              epTotal={eps.length}
              // ★ 2026-10-16（用户要求）：全屏播放器「选集」—— 传**本线路**的集列表（与 上一集/下一集 同一份）
              //   从历史记录进入时 applyInit 会重新取详情把 eps 补全 ⇒ 这边同样可用
              episodes={eps}
              onPickEpisode={(idx) => selectEpisode(idx)}
              cover={init?.meta?.pic}
              // ★ 2026-10-08（用户要求）：跳过片头片尾 —— 资源键（与历史分组同口径）+ 本集键（原始 episode url）
              skipResourceKey={historyGroupKey({
                sourceKey: init?.meta?.fromKey || init?.key,
                vodId: init?.meta?.vodId ?? init?.meta?.id,
                name: curName,
                url: eps[epIndex]?.url,
                profileId: init?.meta?.profileId,
              })}
              skipEpisodeKey={eps[epIndex]?.url || `#${epIndex}`}
              skipEpisodeLabel={eps[epIndex]?.name || curName}
            />
          ) : (
            !hasRecoveryState ? <div className="empty">{resolving ? '正在解析本集…' : '等待播放…'}</div> : null
          )}
        </div>
      </div>
    </>
  );
}
