// src/renderer/features/subscriptions/SourcePicker.tsx
// 换源入口：**源名只显示文字**，**左键单击**弹出源列表浮层选择；**鼠标离开（按钮 + 弹层）即自动收起**。
// 经典皮肤与 TopNav 皮肤共用本组件。
// ★ 2026-09-24（用户定稿）：换源改成「手机 TVBox」那套 —— 源名只显示文字。
// ★ 2026-09-30（用户要求）：
//   ① 弹层为「左子仓 / 右站点」双栏：左侧浏览子仓，右侧选站点时原子切换子仓与站点；名字过长省略显示；
//   ② 顶部加**源名实时检索**（在当前订阅的源里随输入过滤；回车选中首个匹配）；
//   ③ 跨子仓点选 = 一步完成「切换档案 + 选中站点」（CFG_SWITCH_PROFILE_SOURCE，单次 apply）；
//   ④ **触发方式由「长按≥500ms 或右键」改为「左键单击」**（原长按/右键已移除），
//      并在鼠标离开换源区域后自动收起（带 150ms 宽限，越过「按钮↔弹层」那道 6px 缝隙时不闪关）。
// 用法：
//   - 受控：传 sites/current/onPick（点播页 .topbar 用，直接联动 HomePage 的 chooseSource）
//   - 自取：不传 sites 时自己 cfgGet 取源列表，选中后广播 winbox:source-changed（顶栏/侧栏用）
// ★ 2026-10-09（用户指令：「删除之前版本做的换源的下拉菜单调整源的位置的功能，不美观」）：
//   源行内管理按钮（⤒置顶 / ↑上移 / ↓下移 / ✕删除）与本组件内的对应逻辑已删除 —— 源管理只在配置页保留
//   （IPC `cfg:moveSource` / `cfg:deleteSource` 未动）。
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSourcePickerOverlay } from '../../components/useSourcePickerOverlay';
import type { SourceBean } from '../../../shared/types';
import type { SourcePickerPort } from './application/sourcePickerPort';
import { presentSourcePicker } from './application/sourcePickerPresentation';
import { useSourcePickerController } from './useSourcePickerController';

export interface SourcePickerProps {
  /** 源列表（不传则内部自取） */
  sites?: SourceBean[];
  /** 当前源 key（不传则内部自取） */
  current?: string;
  /** 选中回调（不传则内部调用 cfgSetActiveSource 并广播事件） */
  onPick?: (key: string) => void;
  /** Source/profile loading and switching are composed outside the view. */
  port: SourcePickerPort;
  /** 顶栏小按钮 / 侧栏文字行 */
  variant?: 'pill' | 'sidebar';
  disabled?: boolean;
}

export default function SourcePicker({ sites, current, onPick, port, variant = 'pill', disabled }: SourcePickerProps) {
  const overlay = useSourcePickerOverlay({ variant, disabled });
  const { open, query: q, setQuery: setQ, closing, inputRef, triggerRef, panelRef, wrapRef, panelId, panelPosition } = overlay;
  const selfLoad = sites === undefined || current === undefined;
  const { model, actions } = useSourcePickerController({ port, enabled: selfLoad, open, onPick, currentSourceKey: current });
  const { sources: ownSites, activeSourceKey: ownKey, profileSites: views, selectedProfileId: paneId, error, switching } = model;
  const list = sites ?? ownSites;
  const cur = current ?? ownKey;
  const [showEmptyProfiles, setShowEmptyProfiles] = useState(false);
  const srcColRef = useRef<HTMLDivElement | null>(null);
  /** ★ 2026-10-16（用户要求「展开即定位当前所在的源」）：当前源那一行的 DOM（定位用，见上面 effect） */
  const activeRef = useRef<HTMLButtonElement | null>(null);

  // ★ 2026-09-30：换订阅 / 改检索词后右栏回到顶部 —— 否则沿用上一份订阅的滚动位置，
  //   看上去像"列表里混着别的源"。
  // ★ 2026-10-16（用户要求）：**展开弹层时自动定位「当前所在的源」**，不再回到列表顶层 ——
  //   只有「检索中」与「当前源不在这一栏清单里（切到了别的订阅）」才回顶部；
  //   其余时机（打开弹层 / 档案视图拉回 / 切回当前订阅）把当前源滚到可视区**中部**。
  //   ★ 位置用两个 `offsetTop` 相减（同为相对 `.srcpick-pop` 的**布局值**）：不受弹层进场动画
  //     `popIn` 的 `transform: scale(.97)` 影响，也不受 `.srcpick-pop` 的 6px 内边距干扰。
  useEffect(() => {
    const col = srcColRef.current;
    if (!col) return;
    const el = activeRef.current;
    if (q.trim() || !el || !col.contains(el)) {
      col.scrollTop = 0;
      return;
    }
    col.scrollTop = Math.max(0, el.offsetTop - col.offsetTop - (col.clientHeight - el.offsetHeight) / 2);
  }, [open, q, paneId, views, cur, list]);

  const presentation = presentSourcePicker({
    sources: list,
    controlledSources: sites !== undefined,
    activeSourceKey: cur,
    profileSites: views,
    selectedProfileId: paneId,
    query: q,
  });
  const { label, profiles, selectedProfile: pane, hasMultipleProfiles: multi, paneIsActive, filteredSources: filtered } = presentation;
  const emptyProfileCount = profiles.filter(profile => profile.id !== views?.activeId && profile.sites.length === 0 && profile.restorable !== false).length;
  const visibleProfiles = profiles.filter(profile =>
    showEmptyProfiles || profile.id === views?.activeId || profile.sites.length > 0 || profile.restorable === false,
  );

  /** The left column only browses a profile's sources; switching happens atomically on source selection. */
  const selectPane = (id: string): void => { actions.selectProfilePane(id); };

  /**
   * 点选某源：目标订阅 = 当前生效订阅 → 按常规来源选择流程处理；
   * 否则先切换档案再选中源（一步完成），并广播两类变更事件让各页同步。
   */
  const pickSource = async (k: string): Promise<void> => {
    overlay.closeToTrigger();
    if (await actions.pickSource(k)) return;
    overlay.reopen();
  };

  const isSidebar = variant === 'sidebar';

  return (
    <div
      ref={wrapRef}
      className={`srcpick${isSidebar ? ' srcpick-side' : ''}`}
      onPointerEnter={overlay.cancelLeave}
      onPointerLeave={overlay.scheduleLeave}
      onBlur={overlay.onWrapperBlur}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`srcpick-name ui-action${disabled ? ' disabled' : ''}`}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`切换站点，当前：${label}`}
        title={`当前源：${label}\n点击切换源`}
        onClick={(event) => overlay.toggle(event, () => { setShowEmptyProfiles(false); actions.clearError(); actions.beginOpen(); })}
        onContextMenu={(e) => e.preventDefault()}
      >
        {isSidebar ? <span className="srcpick-label">站点</span> : null}
        <span className="srcpick-text">{label}</span>
        <span className="srcpick-caret">▾</span>
      </button>
      {open && createPortal(
        <section
          ref={panelRef}
          id={panelId}
          style={panelPosition}
          className={`srcpick-pop${pane && multi ? ' srcpick-pop-wide' : ''}${isSidebar ? ' srcpick-pop-side' : ''}${closing ? ' srcpick-closing' : ''}`}
          aria-label="订阅和来源"
          onPointerEnter={overlay.cancelLeave}
          onPointerLeave={overlay.scheduleLeave}
        >
          {error && <div className="err" role="alert">{error}</div>}
          <div className="srcpick-pop-tip">
            {presentation.tip}
          </div>
          <input
            ref={inputRef}
            className="srcpick-search"
            aria-label="筛选当前查看子仓的站点"
            placeholder="输入站点名筛选…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(event) => overlay.onSearchKeyDown(event, () => {
              if (filtered.length) void pickSource(filtered[0].key);
            })}
          />
          <div className="srcpick-cols">
            {pane && multi && (
              <div className="srcpick-col-sub" role="group" aria-label="子仓，点选后查看该子仓的站点">
                <div className="srcpick-col-heading">
                  <span>子仓</span>
                  {emptyProfileCount > 0 && (
                    <button
                      type="button"
                      className="srcpick-empty-toggle"
                      aria-pressed={showEmptyProfiles}
                      onClick={() => {
                        if (showEmptyProfiles && pane && pane.id !== views?.activeId && pane.sites.length === 0) {
                          actions.selectProfilePane(views?.activeId ?? '');
                        }
                        setShowEmptyProfiles(value => !value);
                      }}
                    >
                      {showEmptyProfiles ? '隐藏无点播源' : `显示无点播源 ${emptyProfileCount}`}
                    </button>
                  )}
                </div>
                {visibleProfiles.map((p) => {
                  const current = p.id === views!.activeId;
                  const selected = p.id === pane.id;
                  const restorable = p.restorable !== false;
                  const state = restorable
                    ? `${p.sites.length} 个点播源${current ? ' · 当前使用' : ''}`
                    : `无法切换，${p.unavailableReason || '配置快照不可用'}`;
                  return (
                    <div className="srcpick-sub-row" key={p.id}>
                      <button
                        type="button"
                        aria-label={`${p.name}，${state}`}
                        aria-pressed={selected}
                        aria-current={current ? 'true' : undefined}
                        aria-disabled={!restorable || undefined}
                        className={`srcpick-item ui-action srcpick-sub${selected ? ' active' : ''}${current ? ' cur' : ''}${!restorable ? ' unavailable' : ''}`}
                        title={`${p.name} · ${state}`}
                        disabled={switching || !restorable}
                        onClick={() => selectPane(p.id)}
                      >
                        <span className="srcpick-profile-heading">
                          <span className="srcpick-sname">{p.name}</span>
                          {(current || selected) && (
                            <span className={`srcpick-profile-state${current ? ' current' : ' previewing'}`}>
                              {current ? '当前使用' : '正在查看'}
                            </span>
                          )}
                        </span>
                        <span className={`srcpick-profile-meta${!restorable ? ' unavailable' : ''}`}>
                          {restorable ? `${p.sites.length} 个点播源` : p.unavailableReason || '配置快照不可用'}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <div
              className="srcpick-col-src"
              ref={srcColRef}
              role="group"
              aria-label={pane && pane.id !== views?.activeId ? '站点，选中后切换到该子仓和站点' : '站点，选中后切换当前内容'}
            >
              <div className="srcpick-col-heading">站点{pane && pane.id !== views?.activeId ? ' · 选中后切换子仓与站点' : ' · 选中后切换当前内容'}</div>
              {filtered.length === 0 && (
                <div className="srcpick-item muted">{presentation.emptyMessage}</div>
              )}
              {filtered.map((s) => (
                <button
                  type="button"
                  key={s.key}
                  aria-pressed={paneIsActive && s.key === cur}
                  aria-current={paneIsActive && s.key === cur ? 'true' : undefined}
                  className={`srcpick-item ui-action${paneIsActive && s.key === cur ? ' active' : ''}`}
                  ref={paneIsActive && s.key === cur ? activeRef : undefined}
                  title={`${s.name || s.key}（${s.key}）`}
                  disabled={switching}
                  onClick={() => void pickSource(s.key)}
                >
                  <span className="srcpick-sname">{s.name || s.key}</span>
                  {paneIsActive && s.key === cur && <span className="srcpick-item-state current">当前</span>}
                </button>
              ))}
            </div>
          </div>
        </section>, document.body,
      )}
    </div>
  );
}
