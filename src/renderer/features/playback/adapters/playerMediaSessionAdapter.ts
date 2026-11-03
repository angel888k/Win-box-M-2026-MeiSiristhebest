import type {
  PlayerMediaSessionAction,
  PlayerMediaSessionActionHandler,
  PlayerMediaSessionMetadata,
  PlayerMediaSessionPort,
  PlayerMediaSessionPlaybackState,
} from '../application/playerMediaSession';

function currentMediaSession(): MediaSession | null {
  if (typeof navigator === 'undefined') return null;
  try { return navigator.mediaSession ?? null; } catch { return null; }
}

/** Browser/Electron adapter; no-op on Chromium builds without Media Session support. */
export const playerMediaSessionAdapter: PlayerMediaSessionPort = {
  setMetadata(metadata: PlayerMediaSessionMetadata | null) {
    const session = currentMediaSession();
    if (!session) return;
    try {
      if (!metadata) {
        session.metadata = null;
        return;
      }
      if (typeof MediaMetadata === 'undefined') return;
      session.metadata = new MediaMetadata({
        title: metadata.title,
        artist: metadata.artist || '',
        album: metadata.album || '',
      });
    } catch { /* An unsupported metadata constructor must not affect playback. */ }
  },
  setActionHandler(action: PlayerMediaSessionAction, handler: PlayerMediaSessionActionHandler | null) {
    const session = currentMediaSession();
    if (!session) return;
    session.setActionHandler(action, handler
      ? details => handler({ seekOffset: details.seekOffset, seekTime: details.seekTime })
      : null);
  },
  setPlaybackState(state: PlayerMediaSessionPlaybackState) {
    // The Web Media Session API has no "unknown" value. Leave the platform state
    // untouched until the media element gives us a real playback receipt.
    if (state === 'unknown') return;
    const session = currentMediaSession();
    if (!session) return;
    try { session.playbackState = state; } catch { /* Playback-state support is optional in embedded Chromium. */ }
  },
};
