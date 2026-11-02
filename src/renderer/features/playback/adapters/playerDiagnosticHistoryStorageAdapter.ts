import {
  normalizePlayerDiagnosticHistory,
  PLAYER_DIAGNOSTIC_HISTORY_LIMIT,
  type PlayerDiagnosticHistoryPort,
  type PlayerDiagnosticRecord,
} from '../application/playerDiagnosticHistory';

export const PLAYER_DIAGNOSTIC_HISTORY_STORAGE_KEY = 'winbox:playback-diagnostic-history:v1';

export interface PlayerDiagnosticStoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Local, bounded and URL-free playback diagnostics. Storage errors never interrupt playback. */
export function createPlayerDiagnosticHistoryStorageAdapter(
  storage: PlayerDiagnosticStoragePort,
): PlayerDiagnosticHistoryPort {
  return {
    read: () => {
      try {
        const serialized = storage.getItem(PLAYER_DIAGNOSTIC_HISTORY_STORAGE_KEY);
        return serialized ? normalizePlayerDiagnosticHistory(JSON.parse(serialized)) : [];
      } catch {
        return [];
      }
    },
    write: (records: readonly PlayerDiagnosticRecord[]) => {
      try {
        storage.setItem(PLAYER_DIAGNOSTIC_HISTORY_STORAGE_KEY, JSON.stringify(normalizePlayerDiagnosticHistory(records).slice(0, PLAYER_DIAGNOSTIC_HISTORY_LIMIT)));
      } catch {
        // Quota or disabled local storage must not break the player.
      }
    },
    clear: () => {
      try { storage.removeItem(PLAYER_DIAGNOSTIC_HISTORY_STORAGE_KEY); } catch { /* Storage cleanup is best effort. */ }
    },
  };
}

export const playerDiagnosticHistoryStorageAdapter: PlayerDiagnosticHistoryPort = createPlayerDiagnosticHistoryStorageAdapter({
  getItem: key => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
  removeItem: key => window.localStorage.removeItem(key),
});
