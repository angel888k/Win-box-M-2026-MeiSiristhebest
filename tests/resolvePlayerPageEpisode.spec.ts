import { describe, expect, it, vi } from 'vitest';
import type { PlayResult } from '../src/shared/types';
import type { PlayerInitData, PlayerPlaybackResolutionPort } from '../src/renderer/features/playback/application/playerPageSession';
import type { PlayerPageSessionAction } from '../src/renderer/features/playback/application/playerPageSessionState';
import { resolvePlayerPageEpisode } from '../src/renderer/features/playback/application/resolvePlayerPageEpisode';

function successfulPlay(url: string): PlayResult {
  return { parse: 0, url, playUrl: '', flag: 'line-a' };
}

function createFixture(play: PlayerPlaybackResolutionPort['play']) {
  const data: PlayerInitData = {
    key: 'source-a',
    flag: 'line-a',
    episodes: [{ name: 'Episode 1', url: 'episode-1' }],
    epIndex: 0,
    title: 'Example show',
    lastUrl: '',
    lastName: '',
    meta: { fromKey: 'source-a', sourceName: 'Source A', profileId: 'profile-a', vodId: 'vod-1' },
  };
  const actions: PlayerPageSessionAction[] = [];
  const ports = {
    playback: { play } satisfies PlayerPlaybackResolutionPort,
    publish: (action: PlayerPageSessionAction) => actions.push(action),
    isCurrent: () => true,
  };
  return { data, actions, ports };
}

describe('resolvePlayerPageEpisode', () => {
  it('publishes a successful playable URL without claiming that playback has started', async () => {
    const fixture = createFixture(vi.fn(async () => successfulPlay('https://media.invalid/episode.mp4')));

    await resolvePlayerPageEpisode({ data: fixture.data, index: 0 }, fixture.ports);

    expect(fixture.actions.map((action) => action.type)).toEqual(['resolution-started', 'resolution-succeeded']);
    expect(fixture.actions[1]).toMatchObject({ type: 'resolution-succeeded', url: 'https://media.invalid/episode.mp4' });
  });

  it('does not publish an outdated resolution', async () => {
    let finish!: (result: PlayResult) => void;
    const fixture = createFixture(vi.fn(() => new Promise<PlayResult>((resolve) => { finish = resolve; })));
    let current = true;
    fixture.ports.isCurrent = () => current;

    const pending = resolvePlayerPageEpisode({ data: fixture.data, index: 0 }, fixture.ports);
    current = false;
    finish(successfulPlay('https://media.invalid/old.mp4'));
    await pending;

    expect(fixture.actions.map((action) => action.type)).toEqual(['resolution-started']);
  });

  it('maps thrown resolver errors into failed state', async () => {
    const fixture = createFixture(vi.fn(async () => { throw new Error('resolver offline'); }));

    await resolvePlayerPageEpisode({ data: fixture.data, index: 0 }, fixture.ports);

    expect(fixture.actions.at(-1)).toEqual({ type: 'resolution-failed', message: 'resolver offline' });
  });

  it('rejects a resolver result without a playable URL', async () => {
    const fixture = createFixture(vi.fn(async () => successfulPlay('')));

    await resolvePlayerPageEpisode({ data: fixture.data, index: 0 }, fixture.ports);

    expect(fixture.actions.at(-1)).toMatchObject({ type: 'resolution-failed' });
  });

  it('ignores an out-of-range episode before issuing a playback request', async () => {
    const play = vi.fn(async () => successfulPlay('https://media.invalid/episode.mp4'));
    const fixture = createFixture(play);

    await resolvePlayerPageEpisode({ data: fixture.data, index: 1 }, fixture.ports);

    expect(play).not.toHaveBeenCalled();
    expect(fixture.actions).toEqual([]);
  });
});
