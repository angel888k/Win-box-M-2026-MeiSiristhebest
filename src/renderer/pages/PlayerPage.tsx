import { useEffect, useState } from 'react';
import { playerWindowTitle } from '../lib/videoResolution';
import { playerWindowControlEventsAdapter } from '../features/playback/adapters/playerWindowControlEventsAdapter';
import { playerMpvCommandAdapter } from '../features/playback/adapters/playerKernelCommandsAdapter';
import { playerHistoryProgressAdapter } from '../features/playback/adapters/playerHistoryProgressAdapter';
import { playerClipboardAdapter } from '../features/playback/adapters/playerClipboardAdapter';
import { playerDiagnosticHistoryStorageAdapter, PLAYER_DIAGNOSTIC_HISTORY_STORAGE_KEY } from '../features/playback/adapters/playerDiagnosticHistoryStorageAdapter';
import { playerPageSessionAdapter } from '../features/playback/adapters/playerPageSessionAdapter';
import { playerPageWindowAdapter } from '../features/playback/adapters/playerPageWindowAdapter';
import { playerSourceMemoryAdapter } from '../features/playback/adapters/playerSourceMemoryAdapter';
import { copyPlayerDiagnostic } from '../features/playback/application/playerDiagnostic';
import { clearPlayerDiagnosticHistory, recordPlayerDiagnostic, type PlayerDiagnosticRecord } from '../features/playback/application/playerDiagnosticHistory';
import { usePlayerPageSession } from '../features/playback/usePlayerPageSession';
import type { PlayerPageSession } from '../features/playback/usePlayerPageSession';
import { usePlayerPageWindow } from '../features/playback/usePlayerPageWindow';
import { usePlayerWindowControls } from '../features/playback/usePlayerWindowControls';
import { PlayerPageView } from './PlayerPageView';

export default function PlayerPage() {
  const session = usePlayerPageSession(playerPageSessionAdapter, playerHistoryProgressAdapter, playerSourceMemoryAdapter);
  const windowState = usePlayerPageWindow(playerPageWindowAdapter);
  const [resolution, setResolution] = useState('');
  const [diagnosticHistory, setDiagnosticHistory] = useState<readonly PlayerDiagnosticRecord[]>(() => playerDiagnosticHistoryStorageAdapter.read());
  const title = playerWindowTitle(session.curName, resolution);
  const fallbackMessage = session.sourceFallback.kind === 'unavailable' ? session.sourceFallback.message : '';
  const fallbackInProgress = session.sourceFallback.kind === 'searching' || session.sourceFallback.kind === 'switching';
  const diagnosticMessage = fallbackMessage || session.parseMsg;

  useEffect(() => {
    if (!diagnosticMessage || fallbackInProgress) return;
    const failure = session.playbackFailure;
    setDiagnosticHistory(recordPlayerDiagnostic({
      message: diagnosticMessage,
      title: session.playName || session.curName || title,
      sourceName: session.init?.meta?.sourceName || session.init?.meta?.fromKey || session.init?.key,
      engine: failure?.engine,
      failure,
    }, playerDiagnosticHistoryStorageAdapter));
  }, [diagnosticMessage, fallbackInProgress, session.curName, session.init, session.playName, session.playbackFailure, title]);

  useEffect(() => {
    const refreshHistory = (event: StorageEvent) => {
      if (event.key === PLAYER_DIAGNOSTIC_HISTORY_STORAGE_KEY || event.key === null) {
        setDiagnosticHistory(playerDiagnosticHistoryStorageAdapter.read());
      }
    };
    window.addEventListener('storage', refreshHistory);
    return () => window.removeEventListener('storage', refreshHistory);
  }, []);

  usePlayerWindowControls({
    events: playerWindowControlEventsAdapter,
    commands: playerMpvCommandAdapter,
    currentEpisodeIndex: session.epIndex,
    episodeCount: session.episodes.length,
    onSelectEpisode: session.selectEpisode,
  });

  const copyDiagnostic = (message: string, failure?: PlayerPageSession['playbackFailure']) => copyPlayerDiagnostic({
    message,
    title: session.playName || session.curName || title,
    sourceName: session.init?.meta?.sourceName || session.init?.meta?.fromKey || session.init?.key,
    engine: failure?.engine,
    failure,
  }, playerClipboardAdapter);

  const clearDiagnosticHistory = () => {
    clearPlayerDiagnosticHistory(playerDiagnosticHistoryStorageAdapter);
    setDiagnosticHistory([]);
  };

  return <PlayerPageView session={session} windowState={windowState} title={title} onResolutionChange={setResolution} onCopyDiagnostic={copyDiagnostic} diagnosticHistory={diagnosticHistory} onClearDiagnosticHistory={clearDiagnosticHistory} />;
}
