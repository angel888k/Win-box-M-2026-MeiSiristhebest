import { useCallback, useEffect, useRef, useState } from 'react';
import type { KernelPref } from '../../lib/kernel';
import { normalizeSpdif } from '../../../shared/player';
import type { PlayerFit, PlayerPreferencesPort, PlayerPrefs } from './application/playerPreferences';

/** Owns playback preference state; persistence is supplied through a feature port. */
export function usePlayerPreferences(storage: PlayerPreferencesPort, workKey = '') {
  const [initialPreferences] = useState(() => storage.load());
  const [initialWorkPreferences] = useState(() => workKey ? storage.loadForWork?.(workKey) || null : null);
  const [subtitleOffset, setSubtitleOffset] = useState(initialWorkPreferences?.subOffset ?? initialPreferences.subOffset);
  const activeWorkKeyRef = useRef(workKey);
  const preferencesRef = useRef<PlayerPrefs | null>(initialPreferences);

  const [volume, setVolume] = useState(initialPreferences.vol);
  const volumeRef = useRef(initialPreferences.vol);
  const [rate, setRate] = useState(initialWorkPreferences?.rate ?? initialPreferences.rate);
  const [fit, setFit] = useState<PlayerFit>(initialWorkPreferences?.fit ?? initialPreferences.fit);
  const [kernelPreference, setKernelPreferenceState] = useState<KernelPref>(initialPreferences.kernel);
  const [spdif, setSpdif] = useState(() => normalizeSpdif(initialPreferences.spdif));
  const kernelPreferenceRef = useRef(initialPreferences.kernel);
  const setKernelPreference = useCallback((next: KernelPref) => {
    kernelPreferenceRef.current = next;
    setKernelPreferenceState(next);
  }, []);

  // Reset only work-specific controls when the media identity changes. Updating
  // this component's own state during render avoids briefly persisting the
  // previous work's values under the next work key.
  if (activeWorkKeyRef.current !== workKey) {
    activeWorkKeyRef.current = workKey;
    const global = storage.load();
    const work = (workKey && storage.loadForWork?.(workKey)) || {};
    setRate(work.rate ?? global.rate);
    setFit(work.fit ?? global.fit);
    setSubtitleOffset(work.subOffset ?? global.subOffset);
  }
  const rememberKernelPreference = useCallback((next: KernelPref) => {
    setKernelPreference(next);
    storage.save({ kernel: next });
  }, [setKernelPreference, storage]);

  /** Temporary boss-key mute must not overwrite the user's remembered volume. */
  const bossKeyActiveRef = useRef(false);
  const setBossKeyActive = useCallback((active: boolean) => {
    bossKeyActiveRef.current = active;
  }, []);
  const applyPlaybackSettings = useCallback(({ volume: nextVolume, rate: nextRate }: { volume: number; rate: number }) => {
    volumeRef.current = nextVolume;
    setVolume(nextVolume);
    setRate(nextRate);
  }, [setVolume, setRate]);

  const syncPreferences = useCallback((subtitleOffset: number) => {
    // Keep the work-change restore baseline in sync with user edits. Otherwise
    // switching to a work whose offset equals the older baseline would not
    // trigger the subtitle hook's offset reset.
    setSubtitleOffset(subtitleOffset);
    preferencesRef.current = {
      vol: volume,
      rate,
      subOffset: subtitleOffset,
      fit,
      kernel: kernelPreferenceRef.current,
      spdif,
    };
    if (bossKeyActiveRef.current) return;
    const patch = { vol: volume, rate, subOffset: subtitleOffset, fit, spdif };
    storage.save(patch);
    if (workKey) storage.saveForWork?.(workKey, { rate, subOffset: subtitleOffset, fit });
  }, [volume, rate, fit, spdif, storage, workKey]);

  return {
    preferencesRef,
    initialSubtitleOffset: subtitleOffset,
    volumeRef,
    bossKeyActiveRef,
    setBossKeyActive,
    applyPlaybackSettings,
    kernelPreferenceRef,
    syncPreferences,
    volume,
    setVolume,
    rate,
    setRate,
    fit,
    setFit,
    kernelPreference,
    setKernelPreference,
    rememberKernelPreference,
    spdif,
    setSpdif,
  };
}

export interface PlayerPreferencePersistenceOptions {
  volume: number;
  rate: number;
  subtitleOffset: number;
  fit: PlayerFit;
  spdif: string;
  volumeRef: { current: number };
  syncPreferences: (subtitleOffset: number) => void;
}

/** Persists the preference snapshot and updates its imperative volume mirror. */
export function usePlayerPreferencePersistence({
  volume,
  rate,
  subtitleOffset,
  fit,
  spdif,
  volumeRef,
  syncPreferences,
}: PlayerPreferencePersistenceOptions): void {
  useEffect(() => {
    volumeRef.current = volume;
    syncPreferences(subtitleOffset);
  }, [volume, rate, subtitleOffset, fit, spdif, volumeRef, syncPreferences]);
}
