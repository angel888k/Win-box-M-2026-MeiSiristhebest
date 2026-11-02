import { describe, expect, it } from 'vitest';
import { extractHtmlTextTrackChapters, extractMpvChapters, samePlayerChapters } from '../src/shared/playerChapters';
import { initialKernelState, MPV_OBSERVED, reduceMpvMessage } from '../src/main/player/mpvCore';

describe('player chapter extraction', () => {
  it('extracts and orders MPV chapter-list entries while rejecting invalid timestamps', () => {
    expect(extractMpvChapters([
      { title: 'Ending', time: 90 },
      { title: '  <b>Opening</b>  ', time: 0 },
      { title: '', time: 45 },
      { title: 'invalid', time: Number.NaN },
      { title: 'negative', time: -1 },
    ])).toEqual([
      { id: 'mpv-1', title: 'Opening', startSeconds: 0 },
      { id: 'mpv-2', title: '章节 3', startSeconds: 45 },
      { id: 'mpv-0', title: 'Ending', startSeconds: 90 },
    ]);
    expect(extractMpvChapters([])).toEqual([]);
    expect(extractMpvChapters(null)).toBeNull();
  });

  it('reads only HTML chapter tracks and keeps absence distinct from an empty list', () => {
    const chapters = extractHtmlTextTrackChapters([
      { kind: 'subtitles', cues: [{ startTime: 0, text: 'subtitle' }] },
      { kind: 'chapters', cues: [
        { startTime: 30, text: 'Second' },
        { startTime: 0, text: 'First' },
        { startTime: Number.POSITIVE_INFINITY, text: 'invalid' },
      ] },
    ]);
    expect(chapters).toEqual([
      { id: 'html-1-1', title: 'First', startSeconds: 0 },
      { id: 'html-1-0', title: 'Second', startSeconds: 30 },
    ]);
    expect(extractHtmlTextTrackChapters([{ kind: 'chapters', cues: [] }])).toBeNull();
    expect(extractHtmlTextTrackChapters(null)).toBeNull();
  });

  it('receives MPV chapter-list through the existing observed-property state path', () => {
    expect(MPV_OBSERVED).toContainEqual({ id: 24, name: 'chapter-list' });
    const state = initialKernelState();
    const changed = reduceMpvMessage(state, {
      event: 'property-change',
      name: 'chapter-list',
      data: [{ title: 'Scene 1', time: 12.5 }],
    });
    expect(changed).toBe(true);
    expect(state.chapters).toEqual([{ id: 'mpv-0', title: 'Scene 1', startSeconds: 12.5 }]);
    expect(reduceMpvMessage(state, {
      event: 'property-change',
      name: 'chapter-list',
      data: [{ title: 'Scene 1', time: 12.5 }],
    })).toBe(false);
  });

  it('compares chapter snapshots by identity, title, and start time', () => {
    const chapters = [{ id: 'mpv-0', title: 'Intro', startSeconds: 0 }];
    expect(samePlayerChapters(chapters, [...chapters])).toBe(true);
    expect(samePlayerChapters(chapters, null)).toBe(false);
  });
});
