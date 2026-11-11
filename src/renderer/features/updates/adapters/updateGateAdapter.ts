import { client } from '../../../api/client';
import { DISK_UPDATE_URL, UPDATE_RELEASES_PAGE } from '../../../../shared/update';
import type { UpdateGatePort } from '../application/updateGate';

/** Electron IPC and browser handoff stay behind the update feature's port. */
export function createUpdateGateAdapter(): UpdateGatePort {
  return {
    checkForUpdate: () => client.updateCheck(),
    downloadUpdate: () => client.updateDownload(),
    cancelDownload: () => client.updateCancel(),
    installUpdate: () => client.updateInstall(),
    subscribeToProgress: (listener) => client.onUpdateProgress(listener),
    openBackupDownload: () => {
      const url = DISK_UPDATE_URL.trim() || UPDATE_RELEASES_PAGE;
      window.open(url, '_blank', 'noopener,noreferrer');
    },
  };
}
