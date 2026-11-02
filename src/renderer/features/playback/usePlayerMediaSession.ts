import { useEffect, useRef, type RefObject } from 'react';
import {
  attachPlayerMediaSession,
  readPlayerMediaSessionPlaybackState,
  type PlayerMediaSessionActions,
  type PlayerMediaSessionMetadata,
  type PlayerMediaSessionPort,
} from './application/playerMediaSession';

export interface PlayerMediaSessionOptions {
  port: PlayerMediaSessionPort | null;
  active: boolean;
  /** The element is the runtime receipt source; kernel branding alone never sets playback state. */
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Changes with the selected media URL so an old status cannot leak into a new item. */
  sourceKey: string;
  metadata: PlayerMediaSessionMetadata;
  canSeek: boolean;
  canPrevious: boolean;
  canNext: boolean;
  /** Non-HTML5 engines may provide state only after receiving runtime playback events. */
  runtimePlaybackState?: 'playing' | 'paused' | 'none' | 'unknown';
  actions: PlayerMediaSessionActions;
}

/** Binds OS media keys only for the active built-in playback surface, and always tears them down. */
export function usePlayerMediaSession(options: PlayerMediaSessionOptions): void {
  const actionsRef = useRef(options.actions);
  const sourceKeyRef = useRef<string | null>(null);
  useEffect(() => { actionsRef.current = options.actions; }, [options.actions]);

  const { port, active, videoRef, sourceKey, metadata, canSeek, canPrevious, canNext, runtimePlaybackState } = options;
  const hasPreviousAction = typeof options.actions.previous === 'function';
  const hasNextAction = typeof options.actions.next === 'function';
  useEffect(() => {
    if (!port || !active) return;
    const video = videoRef.current;
    const previousSourceKey = sourceKeyRef.current;
    const sourceChanged = previousSourceKey !== null && previousSourceKey !== sourceKey;
    sourceKeyRef.current = sourceKey;
    const safeSetPlaybackState = (state: 'playing' | 'paused' | 'none' | 'unknown') => {
      try { port.setPlaybackState(state); } catch { /* Platform state cannot disrupt playback. */ }
    };
    const detachMediaSession = attachPlayerMediaSession(port, metadata, {
      play: () => actionsRef.current.play(),
      pause: () => actionsRef.current.pause(),
      seekBy: seconds => actionsRef.current.seekBy(seconds),
      seekTo: seconds => actionsRef.current.seekTo(seconds),
      ...(canPrevious && hasPreviousAction ? { previous: () => actionsRef.current.previous?.() } : {}),
      ...(canNext && hasNextAction ? { next: () => actionsRef.current.next?.() } : {}),
    }, { canSeek, canPrevious: canPrevious && hasPreviousAction, canNext: canNext && hasNextAction });
    if (runtimePlaybackState !== undefined) {
      safeSetPlaybackState(sourceChanged ? 'unknown' : runtimePlaybackState);
      return detachMediaSession;
    }
    if (!video) {
      safeSetPlaybackState('unknown');
      return detachMediaSession;
    }
    let awaitingFreshReceipt = sourceChanged;
    let loadStartedForSource = !sourceChanged;
    const readAndPublish = () => safeSetPlaybackState(readPlayerMediaSessionPlaybackState({
      readyState: video.readyState,
      paused: video.paused,
      ended: video.ended,
      hasError: video.error !== null,
    }));
    const publishState = (event: Event) => {
      if (event.type === 'emptied') {
        awaitingFreshReceipt = true;
        loadStartedForSource = false;
        safeSetPlaybackState('none');
        return;
      }
      if (event.type === 'loadstart') {
        awaitingFreshReceipt = true;
        loadStartedForSource = true;
        safeSetPlaybackState('unknown');
        return;
      }
      if ((event.type === 'loadedmetadata' || event.type === 'playing') && loadStartedForSource) {
        awaitingFreshReceipt = false;
      }
      if (awaitingFreshReceipt) {
        safeSetPlaybackState('unknown');
        return;
      }
      readAndPublish();
    };
    const events = ['loadedmetadata', 'durationchange', 'loadstart', 'play', 'playing', 'pause', 'ended', 'emptied', 'error'] as const;
    for (const event of events) video.addEventListener(event, publishState);
    if (sourceChanged) safeSetPlaybackState('unknown');
    else readAndPublish();
    return () => {
      for (const event of events) video.removeEventListener(event, publishState);
      detachMediaSession();
    };
  }, [active, canNext, canPrevious, canSeek, hasNextAction, hasPreviousAction, metadata.album, metadata.artist, metadata.title, port, runtimePlaybackState, sourceKey, videoRef]);
}
