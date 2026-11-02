import { useEffect, useState } from 'react';
import { extractHtmlTextTrackChapters, type PlayerChapter } from '../../../shared/playerChapters';

export interface HtmlMediaChaptersRef {
  current: HTMLVideoElement | null;
}

/** Reads only browser-reported in-band chapter tracks; absence remains unknown. */
export function useHtmlMediaChapters(
  videoRef: HtmlMediaChaptersRef,
  identity: string,
  enabled: boolean,
): PlayerChapter[] | null {
  const [stored, setStored] = useState<{ identity: string; chapters: PlayerChapter[] | null }>(() => ({ identity, chapters: null }));
  const chapters = stored.identity === identity ? stored.chapters : null;

  useEffect(() => {
    const video = videoRef.current;
    if (!enabled || !video) {
      setStored({ identity, chapters: null });
      return;
    }

    const tracks = video.textTracks;
    const update = () => setStored({ identity, chapters: extractHtmlTextTrackChapters(tracks) });
    // A reused <video> can still expose the previous episode's text tracks
    // while its new source is loading. Read immediately only when this effect
    // is still attached to the same media identity; otherwise wait for the
    // browser to report metadata for the new resource.
    if (stored.identity === identity) update();
    tracks.addEventListener('addtrack', update);
    tracks.addEventListener('change', update);
    video.addEventListener('loadedmetadata', update);
    return () => {
      tracks.removeEventListener('addtrack', update);
      tracks.removeEventListener('change', update);
      video.removeEventListener('loadedmetadata', update);
    };
  }, [enabled, identity, videoRef, stored.identity]);

  return chapters;
}
