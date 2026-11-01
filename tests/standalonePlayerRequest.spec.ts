import { describe, expect, it } from 'vitest';
import { buildStandalonePlayerRequest } from '../src/renderer/features/playback/application/standalonePlayerRequest';

describe('buildStandalonePlayerRequest', () => {
  it.each(['live', 'live-catchup', 'storage'] as const)('keeps %s as a direct, history-free playback request', (playbackKind) => {
    const request = buildStandalonePlayerRequest({
      url: 'https://media.example/stream.m3u8?token=secret',
      title: '  测试频道  ',
      playbackKind,
      profileId: 'profile-a',
      sourceName: '直播线路',
    });

    expect(request).toMatchObject({
      key: '',
      flag: '',
      title: '测试频道',
      lastUrl: 'https://media.example/stream.m3u8?token=secret',
      lastName: '测试频道',
      playbackKind,
      recordHistory: false,
      meta: { profileId: 'profile-a', sourceName: '直播线路' },
      episodes: [{ name: '测试频道', url: 'https://media.example/stream.m3u8?token=secret' }],
    });
  });

  it('provides a readable fallback title for unnamed direct resources', () => {
    expect(buildStandalonePlayerRequest({ url: 'file:///movie.mp4', title: '', playbackKind: 'storage' }).title).toBe('正在播放');
  });
});
