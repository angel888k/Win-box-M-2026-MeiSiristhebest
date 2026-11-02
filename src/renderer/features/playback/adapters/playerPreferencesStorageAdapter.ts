import { loadPlayerPrefs, loadPlayerWorkPrefs, savePlayerPrefs, savePlayerWorkPrefs } from '../../../lib/playerPrefs';
import type { PlayerPreferencesPort } from '../application/playerPreferences';

/** Browser-backed implementation of the playback preference port. */
export const playerPreferencesStorageAdapter: PlayerPreferencesPort = {
  load: loadPlayerPrefs,
  save: savePlayerPrefs,
  loadForWork: loadPlayerWorkPrefs,
  saveForWork: savePlayerWorkPrefs,
};
