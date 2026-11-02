/** A normalized chapter marker shared by HTML media tracks and MPV IPC. */
export interface PlayerChapter {
  id: string;
  title: string;
  startSeconds: number;
}

interface MpvChapterLike {
  title?: unknown;
  time?: unknown;
}

interface TextTrackCueLike {
  startTime?: unknown;
  text?: unknown;
}

interface ChapterTextTrackLike {
  kind?: unknown;
  mode?: unknown;
  cues?: ArrayLike<TextTrackCueLike> | null;
}

function chapterTitle(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const title = value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  return title || fallback;
}

/**
 * Extracts the mpv chapter-list node-array shape (title/time).
 * Invalid or negative timestamps are discarded; missing titles get a stable label.
 */
export function extractMpvChapters(value: unknown): PlayerChapter[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const chapter = entry as MpvChapterLike;
    const startSeconds = chapter.time;
    if (typeof startSeconds !== 'number' || !Number.isFinite(startSeconds) || startSeconds < 0) return [];
    return [{ id: 'mpv-' + index, title: chapterTitle(chapter.title, '章节 ' + (index + 1)), startSeconds }];
  }).sort((left, right) => left.startSeconds - right.startSeconds);
}

/**
 * Reads the first populated HTML TextTrack whose kind is chapters.
 * Browsers expose container chapter metadata only when that format is recognized;
 * an empty result means unavailable, not that the media has no chapters.
 */
export function extractHtmlTextTrackChapters(tracks: ArrayLike<ChapterTextTrackLike> | null | undefined): PlayerChapter[] | null {
  if (!tracks) return null;
  for (let trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
    const track = tracks[trackIndex];
    if (!track || track.kind !== 'chapters' || !track.cues?.length) continue;
    const chapters = Array.from({ length: track.cues.length }, (_, cueIndex) => {
      const cue = track.cues?.[cueIndex];
      const startSeconds = cue?.startTime;
      if (typeof startSeconds !== 'number' || !Number.isFinite(startSeconds) || startSeconds < 0) return null;
      return {
        id: 'html-' + trackIndex + '-' + cueIndex,
        title: chapterTitle(cue?.text, '章节 ' + (cueIndex + 1)),
        startSeconds,
      } satisfies PlayerChapter;
    }).filter((chapter): chapter is PlayerChapter => chapter !== null);
    if (chapters.length) return chapters.sort((left, right) => left.startSeconds - right.startSeconds);
  }
  return null;
}

export function samePlayerChapters(left: readonly PlayerChapter[] | null, right: readonly PlayerChapter[] | null): boolean {
  if (left === null || right === null) return left === right;
  return left.length === right.length && left.every((chapter, index) => {
    const candidate = right[index];
    return candidate?.id === chapter.id
      && candidate.title === chapter.title
      && candidate.startSeconds === chapter.startSeconds;
  });
}
