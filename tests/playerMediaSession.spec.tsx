// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  attachPlayerMediaSession,
  readMpvMediaSessionPlaybackState,
  readPlayerMediaSessionPlaybackState,
  type PlayerMediaSessionAction,
  type PlayerMediaSessionActionHandler,
  type PlayerMediaSessionMetadata,
  type PlayerMediaSessionPort,
} from '../src/renderer/features/playback/application/playerMediaSession';
import { usePlayerMediaSession } from '../src/renderer/features/playback/usePlayerMediaSession';
import { playerMediaSessionAdapter } from '../src/renderer/features/playback/adapters/playerMediaSessionAdapter';

function createPort() {
  const handlers = new Map<PlayerMediaSessionAction, PlayerMediaSessionActionHandler>();
  const port: PlayerMediaSessionPort = {
    setMetadata: vi.fn((_metadata: PlayerMediaSessionMetadata | null) => undefined),
    setPlaybackState: vi.fn((_state) => undefined),
    setActionHandler: vi.fn((action, handler) => {
      if (handler) handlers.set(action, handler);
      else handlers.delete(action);
    }),
  };
  return { port, handlers };
}

describe('player Media Session bridge', () => {
  it('uses MPV runtime readiness and errors instead of assuming the selected kernel is playing', () => {
    expect(readMpvMediaSessionPlaybackState({ readiness: 'unknown', loading: false, paused: false, hasError: false })).toBe('unknown');
    expect(readMpvMediaSessionPlaybackState({ readiness: 'ready', loading: true, paused: false, hasError: false })).toBe('unknown');
    expect(readMpvMediaSessionPlaybackState({ readiness: 'ready', loading: false, paused: true, hasError: false })).toBe('paused');
    expect(readMpvMediaSessionPlaybackState({ readiness: 'ready', loading: false, paused: false, hasError: false })).toBe('playing');
    expect(readMpvMediaSessionPlaybackState({ readiness: 'ready', loading: false, paused: false, hasError: true })).toBe('none');
  });

  it('registers supported actions, seeks relative to the current position and cleans up', () => {
    const { port, handlers } = createPort();
    const actions = { play: vi.fn(), pause: vi.fn(), seekBy: vi.fn(), seekTo: vi.fn(), previous: vi.fn(), next: vi.fn() };
    const dispose = attachPlayerMediaSession(port, { title: '繁花 第01集' }, actions, {
      canSeek: true, canPrevious: true, canNext: true,
    });

    expect(port.setMetadata).toHaveBeenCalledWith({ title: '繁花 第01集' });
    handlers.get('play')?.();
    handlers.get('pause')?.();
    handlers.get('seekbackward')?.({ seekOffset: 8 });
    handlers.get('seekforward')?.({ seekOffset: 12 });
    handlers.get('seekforward')?.({ seekOffset: Number.NaN });
    handlers.get('seekto')?.({ seekTime: 92 });
    handlers.get('seekto')?.({ seekTime: Number.NaN });
    handlers.get('previoustrack')?.();
    handlers.get('nexttrack')?.();

    expect(actions.play).toHaveBeenCalledOnce();
    expect(actions.pause).toHaveBeenCalledOnce();
    expect(actions.seekBy.mock.calls).toEqual([[-8], [12], [10]]);
    expect(actions.seekTo.mock.calls).toEqual([[92]]);
    expect(actions.previous).toHaveBeenCalledOnce();
    expect(actions.next).toHaveBeenCalledOnce();

    dispose();
    expect(handlers.size).toBe(0);
    expect(port.setMetadata).toHaveBeenLastCalledWith(null);
    expect(port.setPlaybackState).toHaveBeenLastCalledWith('none');
  });

  it('does not install seek or track actions when the media does not support them', () => {
    const { port, handlers } = createPort();
    const dispose = attachPlayerMediaSession(port, { title: '直播频道' }, {
      play: vi.fn(), pause: vi.fn(), seekBy: vi.fn(), seekTo: vi.fn(),
    }, { canSeek: false, canPrevious: false, canNext: false });

    expect([...handlers.keys()]).toEqual(['play', 'pause']);
    dispose();
  });

  it('projects only observed media state and treats missing/error/ended media as unknown or stopped', () => {
    expect(readPlayerMediaSessionPlaybackState({ readyState: 0, paused: false, ended: false, hasError: false })).toBe('unknown');
    expect(readPlayerMediaSessionPlaybackState({ readyState: 1, paused: true, ended: false, hasError: false })).toBe('paused');
    expect(readPlayerMediaSessionPlaybackState({ readyState: 3, paused: false, ended: false, hasError: false })).toBe('playing');
    expect(readPlayerMediaSessionPlaybackState({ readyState: 4, paused: false, ended: true, hasError: false })).toBe('none');
    expect(readPlayerMediaSessionPlaybackState({ readyState: 4, paused: false, ended: false, hasError: true })).toBe('none');
  });

  it('does not translate unknown into a native playing state', () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(navigator, 'mediaSession');
    const session = { playbackState: 'paused' } as MediaSession;
    Object.defineProperty(navigator, 'mediaSession', { configurable: true, value: session });
    try {
      playerMediaSessionAdapter.setPlaybackState('unknown');
      expect(session.playbackState).toBe('paused');
      playerMediaSessionAdapter.setPlaybackState('playing');
      expect(session.playbackState).toBe('playing');
    } finally {
      if (originalDescriptor) Object.defineProperty(navigator, 'mediaSession', originalDescriptor);
      else Reflect.deleteProperty(navigator, 'mediaSession');
    }
  });

  it('does not bind OS handlers when inactive, then tears down on deactivation', () => {
    const { port, handlers } = createPort();
    const actions = { play: vi.fn(), pause: vi.fn(), seekBy: vi.fn(), seekTo: vi.fn() };
    const video = document.createElement('video');
    const videoRef = { current: video };
    const { rerender } = renderHook(({ active }) => usePlayerMediaSession({
      port,
      active,
      videoRef,
      sourceKey: 'source-one',
      metadata: { title: '繁花' },
      canSeek: true,
      canPrevious: false,
      canNext: false,
      actions,
    }), { initialProps: { active: false } });

    expect(handlers.size).toBe(0);
    rerender({ active: true });
    expect(handlers.has('play')).toBe(true);
    act(() => rerender({ active: false }));
    expect(handlers.size).toBe(0);
    expect(port.setMetadata).toHaveBeenLastCalledWith(null);
    expect(port.setPlaybackState).toHaveBeenLastCalledWith('none');
  });

  it('publishes playback state from media events and does not claim playback before a receipt', () => {
    const { port } = createPort();
    const video = document.createElement('video');
    Object.defineProperty(video, 'readyState', { configurable: true, value: 0 });
    Object.defineProperty(video, 'paused', { configurable: true, value: true });
    Object.defineProperty(video, 'ended', { configurable: true, value: false });
    Object.defineProperty(video, 'error', { configurable: true, value: null });
    const videoRef = { current: video };
    const actions = { play: vi.fn(), pause: vi.fn(), seekBy: vi.fn(), seekTo: vi.fn() };
    renderHook(() => usePlayerMediaSession({
      port, active: true, videoRef, sourceKey: 'movie-a', metadata: { title: 'Movie A' },
      canSeek: true, canPrevious: false, canNext: false, actions,
    }));

    expect(port.setPlaybackState).toHaveBeenLastCalledWith('unknown');
    Object.defineProperty(video, 'readyState', { configurable: true, value: 1 });
    act(() => video.dispatchEvent(new Event('loadedmetadata')));
    expect(port.setPlaybackState).toHaveBeenLastCalledWith('paused');
    Object.defineProperty(video, 'readyState', { configurable: true, value: 4 });
    Object.defineProperty(video, 'paused', { configurable: true, value: false });
    act(() => video.dispatchEvent(new Event('playing')));
    expect(port.setPlaybackState).toHaveBeenLastCalledWith('playing');
    Object.defineProperty(video, 'paused', { configurable: true, value: true });
    act(() => video.dispatchEvent(new Event('pause')));
    expect(port.setPlaybackState).toHaveBeenLastCalledWith('paused');
    Object.defineProperty(video, 'ended', { configurable: true, value: true });
    act(() => video.dispatchEvent(new Event('ended')));
    expect(port.setPlaybackState).toHaveBeenLastCalledWith('none');
  });

  it('clears the previous item state when source changes and waits for fresh media metadata', () => {
    const { port } = createPort();
    const video = document.createElement('video');
    Object.defineProperty(video, 'readyState', { configurable: true, value: 4 });
    Object.defineProperty(video, 'paused', { configurable: true, value: false });
    Object.defineProperty(video, 'ended', { configurable: true, value: false });
    Object.defineProperty(video, 'error', { configurable: true, value: null });
    const videoRef = { current: video };
    const actions = { play: vi.fn(), pause: vi.fn(), seekBy: vi.fn(), seekTo: vi.fn() };
    const { rerender } = renderHook(({ sourceKey }) => usePlayerMediaSession({
      port, active: true, videoRef, sourceKey, metadata: { title: sourceKey },
      canSeek: true, canPrevious: false, canNext: false, actions,
    }), { initialProps: { sourceKey: 'movie-a' } });

    expect(port.setPlaybackState).toHaveBeenLastCalledWith('playing');
    rerender({ sourceKey: 'movie-b' });
    expect(port.setPlaybackState).toHaveBeenLastCalledWith('unknown');
    act(() => video.dispatchEvent(new Event('loadstart')));
    Object.defineProperty(video, 'readyState', { configurable: true, value: 1 });
    Object.defineProperty(video, 'paused', { configurable: true, value: true });
    act(() => video.dispatchEvent(new Event('loadedmetadata')));
    expect(port.setPlaybackState).toHaveBeenLastCalledWith('paused');
  });

  it('uses MPV runtime updates and ignores stale events from the hidden HTML video element', () => {
    const { port, handlers } = createPort();
    const video = document.createElement('video');
    Object.defineProperty(video, 'readyState', { configurable: true, value: 4 });
    Object.defineProperty(video, 'paused', { configurable: true, value: false });
    Object.defineProperty(video, 'ended', { configurable: true, value: false });
    Object.defineProperty(video, 'error', { configurable: true, value: null });
    const actions = { play: vi.fn(), pause: vi.fn(), seekBy: vi.fn(), seekTo: vi.fn() };
    const { rerender } = renderHook(({ runtimePlaybackState }) => usePlayerMediaSession({
      port, active: true, videoRef: { current: video }, sourceKey: 'mpv-item',
      metadata: { title: 'MPV item' }, canSeek: true, canPrevious: false, canNext: false,
      runtimePlaybackState, actions,
    }), { initialProps: { runtimePlaybackState: 'unknown' as 'unknown' | 'playing' } });

    expect(port.setPlaybackState).toHaveBeenLastCalledWith('unknown');
    rerender({ runtimePlaybackState: 'playing' });
    expect(port.setPlaybackState).toHaveBeenLastCalledWith('playing');
    act(() => video.dispatchEvent(new Event('pause')));
    expect(port.setPlaybackState).toHaveBeenLastCalledWith('playing');
    act(() => handlers.get('pause')?.());
    expect(actions.pause).toHaveBeenCalledOnce();
  });
});
