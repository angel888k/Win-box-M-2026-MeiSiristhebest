import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { storageBrowserAdapter } from '../features/storage/adapters/storageBrowserAdapter';
import { useStorageBrowserPresenter } from '../features/storage/useStorageBrowserPresenter';
import { StoragePageView } from './StoragePageView';
import { standalonePlayerHandoffAdapter } from '../features/playback/adapters/standalonePlayerHandoffAdapter';

/** Route composition root for the WebDAV browser. */
export default function StoragePage() {
  const navigate = useNavigate();
  const presenter = useStorageBrowserPresenter(useMemo(() => storageBrowserAdapter, []));
  const [handoffMessage, setHandoffMessage] = useState('');

  const openInStandalonePlayer = async () => {
    if (!presenter.playUrl) return;
    setHandoffMessage('正在打开独立播放器…');
    try {
      await standalonePlayerHandoffAdapter.open({
        url: presenter.playUrl,
        title: presenter.playName,
        playbackKind: 'storage',
        sourceName: presenter.currentServer?.name,
      });
      setHandoffMessage('已在独立播放器窗口打开');
    } catch (error) {
      setHandoffMessage(error instanceof Error ? `打开失败：${error.message}` : '打开独立播放器失败');
    }
  };

  return (
    <StoragePageView
      servers={presenter.servers}
      serverId={presenter.serverId}
      currentServer={presenter.currentServer}
      path={presenter.path}
      entries={presenter.entries}
      busy={presenter.busy}
      error={presenter.error}
      message={presenter.message}
      playUrl={presenter.playUrl}
      playName={presenter.playName}
      handoffMessage={handoffMessage}
      breadcrumbs={presenter.breadcrumbs}
      onManage={() => navigate('/config?section=storage')}
      onSelectServer={presenter.selectServer}
      onRefresh={presenter.refresh}
      onBrowse={presenter.goToPath}
      onGoToParent={presenter.goToParent}
      onOpenEntry={(entry) => { void presenter.openEntry(entry); }}
      onOpenStandalonePlayer={() => { void openInStandalonePlayer(); }}
    />
  );
}
