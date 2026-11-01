import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppModal } from '../../components/AppDialog';
import { useProfileSwitcher } from './useProfileSwitcher';
import styles from './ProfileSwitcher.module.css';

import type { ProfileSwitcherPort } from './application/profileSwitcherPort';

interface ProfileSwitcherProps {
  port: ProfileSwitcherPort;
}

export function ProfileSwitcher({ port }: ProfileSwitcherProps) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [showEmptyProfiles, setShowEmptyProfiles] = useState(false);
  const { model, actions } = useProfileSwitcher({ port, query });
  const { config, choices, filtered, activeLabel, error, switching } = model;
  const emptyProfiles = choices.filter(item => item.sourceCount === 0 && item.liveCount === 0 && item.profileId !== config?.activeProfileId);
  const visibleChoices = showEmptyProfiles
    ? filtered
    : filtered.filter(item => item.sourceCount > 0 || item.liveCount > 0 || item.profileId === config?.activeProfileId);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const currentChoice = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    if (!open || !list.current) return;
    const container = list.current;
    const current = currentChoice.current;
    container.scrollTop = !query.trim() && current
      ? Math.max(0, current.offsetTop - container.offsetTop - (container.clientHeight - current.offsetHeight) / 2)
      : 0;
  }, [open, query, config, showEmptyProfiles]);

  return (<>
    <button type="button" className={`${styles.trigger} profile-switch-trigger`} title={`当前子仓：${activeLabel}\n点击切换子仓`} aria-label={`切换子仓，当前：${activeLabel}`} aria-haspopup="dialog" onClick={() => { setQuery(''); setShowEmptyProfiles(false); actions.clearError(); setOpen(true); void actions.refresh(); }}>
      <span className={styles.triggerLabel}>子仓</span><span className={styles.current}>{activeLabel}</span><span aria-hidden="true">▾</span>
    </button>
    <AppModal open={open} titleId={titleId} descriptionId={descriptionId} initialFocusRef={input} className={'app-dialog card modal-in profile-switcher-dialog ' + styles.dialog} canClose={!switching} onClose={() => setOpen(false)}>
      <div className={`${styles.heading} app-dialog-heading`}><h2 id={titleId}>切换子仓</h2><button className="app-dialog-close" type="button" disabled={switching} onClick={() => setOpen(false)}>关闭</button></div>
      <p id={descriptionId} className={`${styles.description} muted`}>切换后，点播站点和直播线路使用该子仓的已保存配置。</p>
      <input ref={input} aria-label="筛选子仓" placeholder="输入子仓或订阅组名称" value={query} onChange={event => setQuery(event.target.value)} />
      {error && <p className="err" role="alert">{error}</p>}
      <div ref={list} className={`${styles.list} profile-switcher-list`} aria-busy={switching}>
        {visibleChoices.map(item => {
          const current = item.profileId === config?.activeProfileId;
          const hasPlayableRoutes = item.sourceCount > 0 || item.liveCount > 0;
          const note = [item.reason, !hasPlayableRoutes ? '没有可播放站点或直播线路；要移除这个档案，请到「管理配置档案」。' : ''].filter(Boolean).join(' · ');
          return <button key={item.id} ref={current ? currentChoice : undefined} type="button" className={`${styles.choice} profile-switcher-choice`} aria-pressed={current} disabled={switching || !item.restorable || !hasPlayableRoutes} onClick={() => { if (item.profileId) void actions.activate(item.profileId).then(activated => { if (activated) setOpen(false); }); }}>
            <span className={`${styles.choiceHeading} profile-switcher-choice-heading`}>
              <span className={`${styles.choiceName} profile-switcher-choice-name`}>{item.name}</span>
              {current && <span className={styles.currentState}>当前使用</span>}
            </span>
            <span className={`${styles.meta} profile-switcher-choice-meta`}>{item.groupName} · {item.sourceCount} 个站点 · {item.liveCount} 条直播</span>
            {note && <span className={`${styles.reason} profile-switcher-choice-reason`}>{note}</span>}
          </button>;
        })}
        {!visibleChoices.length && <p className="muted">{choices.length ? '没有匹配的可切换档案' : config?.subscriptionGroups.length ? '当前没有可用档案；可在“管理配置档案”中查看各成员状态。' : '尚未保存子仓配置，请先导入多仓订阅。'}</p>}
      </div>
      <div className={`${styles.footer} app-dialog-actions profile-switcher-footer`}><span className="muted">{switching ? '正在切换…' : `可切换 ${filtered.filter(item => item.sourceCount > 0 || item.liveCount > 0).length} 个档案${!showEmptyProfiles && emptyProfiles.length ? ` · 已隐藏 ${emptyProfiles.length} 个空档案` : ''}`}</span><div className={styles.footerActions}>{emptyProfiles.length > 0 && <button className="app-dialog-action-secondary" type="button" aria-pressed={showEmptyProfiles} disabled={switching} onClick={() => setShowEmptyProfiles(value => !value)}>{showEmptyProfiles ? '隐藏空档案' : `显示空档案 ${emptyProfiles.length}`}</button>}<button className="app-dialog-action-secondary" type="button" disabled={switching} onClick={() => { setOpen(false); navigate('/config?section=profiles'); }}>管理配置档案</button></div></div>
    </AppModal>
  </>);
}
