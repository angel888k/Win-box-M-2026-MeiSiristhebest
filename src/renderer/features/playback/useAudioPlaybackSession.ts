import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PlaybackPositionScope } from './application/playbackSessionPorts';
import type { PlaybackPositionMemoryPort } from './application/playbackSessionPorts';
import type { AudioPlayerInput } from './application/audioPlayer';
import type {
  AudioMediaElement,
  AudioPlaybackMediaPort,
  AudioPlayerKeyboardEventsPort,
  AudioPlayerShortcutGuardPort,
} from './application/audioPlayerPorts';
import { audioRestorePosition, audioSeekByPosition } from './application/audioPlayback';
import type { AudioPlayerModel } from './presentation/AudioPlayerModel';
import { formatAudioPlaybackTime } from './presentation/formatAudioPlaybackTime';
import { attachPlayerMediaSession } from './application/playerMediaSession';
import type { PlayerMediaSessionActions, PlayerMediaSessionPlaybackState, PlayerMediaSessionPort } from './application/playerMediaSession';

export function useAudioPlaybackSession(
  input: AudioPlayerInput,
  positionMemory: PlaybackPositionMemoryPort,
  mediaPort: AudioPlaybackMediaPort,
  shortcutGuard: AudioPlayerShortcutGuardPort,
  keyboardEvents: AudioPlayerKeyboardEventsPort,
  mediaSessionPort: PlayerMediaSessionPort | null = null,
): AudioPlayerModel {
  const {
    url,
    name,
    playbackSource,
    canPrev,
    canNext,
    onPrev,
    onNext,
    onPlaybackStarted,
    startTime = 0,
  } = input;
  const playbackProfileId = playbackSource?.profileId;
  const playbackSourceKey = playbackSource?.key;
  const progressSource = useMemo<PlaybackPositionScope | undefined>(
    () => playbackSourceKey === undefined ? undefined : { profileId: playbackProfileId, key: playbackSourceKey },
    [playbackProfileId, playbackSourceKey],
  );
  const audioRef = useRef<AudioMediaElement | null>(null);
  const [paused, setPaused] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [loop, setLoop] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const restoredRef = useRef(false);
  const playbackStartedRef = useRef(false);

  const attachAudioElement = useCallback((element: AudioMediaElement | null) => {
    audioRef.current = element;
  }, []);

  const tryRestorePosition = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || restoredRef.current) return;
    const savedPosition = startTime > 3 ? startTime : positionMemory.read(url, progressSource);
    const restoredPosition = audioRestorePosition(savedPosition, mediaPort.duration(audio));
    if (restoredPosition !== undefined) {
      restoredRef.current = true;
      mediaPort.setCurrentTime(audio, restoredPosition);
    }
  }, [mediaPort, positionMemory, progressSource, startTime, url]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setError('');
    setLoading(true);
    setCurrentTime(0);
    setDuration(0);
    restoredRef.current = false;
    playbackStartedRef.current = false;
    mediaPort.load(audio);
    void mediaPort.play(audio).catch(() => {
      // Autoplay rejection leaves the player ready for a user initiated play.
    });
    return () => {
      positionMemory.save(url, mediaPort.currentTime(audio), progressSource);
      mediaPort.pause(audio);
    };
  }, [mediaPort, positionMemory, progressSource, url]);

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (mediaPort.isPaused(audio)) void mediaPort.play(audio).catch(() => undefined);
    else mediaPort.pause(audio);
  }, [mediaPort]);

  const seekTo = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const currentTime = mediaPort.currentTime(audio);
    const nextTime = audioSeekByPosition(currentTime, mediaPort.duration(audio), seconds - currentTime);
    if (nextTime === undefined) return;
    mediaPort.setCurrentTime(audio, nextTime);
    setCurrentTime(mediaPort.currentTime(audio));
  }, [mediaPort]);

  useEffect(() => {
    return keyboardEvents.subscribeKeyboardShortcuts((event) => {
      if (shortcutGuard.shouldIgnoreAudioPlaybackShortcuts()) return;
      if (event.targetIsEditable) return;
      if (event.code === 'Space') {
        event.preventDefault();
        togglePlayback();
      } else if (event.key === 'ArrowLeft' && canPrev) onPrev?.();
      else if (event.key === 'ArrowRight' && canNext) onNext?.();
    });
  }, [canNext, canPrev, keyboardEvents, onNext, onPrev, shortcutGuard, togglePlayback]);

  const onLoadedMetadata = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const audioDuration = mediaPort.duration(audio);
    setDuration(Number.isFinite(audioDuration) ? audioDuration : 0);
    tryRestorePosition();
  }, [mediaPort, tryRestorePosition]);

  const onTimeUpdate = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const nextTime = mediaPort.currentTime(audio);
    setCurrentTime(nextTime);
    positionMemory.save(url, nextTime, progressSource);
  }, [mediaPort, positionMemory, progressSource, url]);

  const setVolume = useCallback((nextVolume: number) => {
    setVolumeState(nextVolume);
    const audio = audioRef.current;
    if (audio) mediaPort.setVolume(audio, nextVolume);
  }, [mediaPort]);
  const toggleLoop = useCallback(() => setLoop(value => !value), []);
  const onCanPlay = useCallback(() => setLoading(false), []);
  const onPlay = useCallback(() => setPaused(false), []);
  const onPause = useCallback(() => setPaused(true), []);
  const onWaiting = useCallback(() => setLoading(true), []);
  const onPlaying = useCallback(() => {
    setLoading(false);
    if (playbackStartedRef.current) return;
    playbackStartedRef.current = true;
    onPlaybackStarted?.();
  }, [onPlaybackStarted]);
  const onError = useCallback(() => {
    setLoading(false);
    setError('音频加载失败（链接可能已失效或需要登录）');
  }, []);
  const onEnded = useCallback(() => {
    if (canNext) onNext?.();
  }, [canNext, onNext]);

  const mediaSessionActionsRef = useRef<PlayerMediaSessionActions>({
    play: () => undefined,
    pause: () => undefined,
    seekBy: () => undefined,
    seekTo: () => undefined,
  });
  const playFromMediaSession = useCallback(() => {
    const audio = audioRef.current;
    if (audio && mediaPort.isPaused(audio)) void mediaPort.play(audio).catch(() => undefined);
  }, [mediaPort]);
  const pauseFromMediaSession = useCallback(() => {
    const audio = audioRef.current;
    if (audio && !mediaPort.isPaused(audio)) mediaPort.pause(audio);
  }, [mediaPort]);
  useLayoutEffect(() => {
    mediaSessionActionsRef.current = {
      play: playFromMediaSession,
      pause: pauseFromMediaSession,
      seekBy: seconds => seekTo((audioRef.current ? mediaPort.currentTime(audioRef.current) : 0) + seconds),
      seekTo,
      ...(canPrev && onPrev ? { previous: onPrev } : {}),
      ...(canNext && onNext ? { next: onNext } : {}),
    };
  });

  const mediaSessionPlaybackState: PlayerMediaSessionPlaybackState = error
    ? 'none'
    : loading
      ? 'unknown'
      : paused
        ? 'paused'
        : 'playing';
  useEffect(() => {
    if (!mediaSessionPort || !url) return;
    const invokeAction = (fn: () => void) => { fn(); };
    const detach = attachPlayerMediaSession(mediaSessionPort, { title: String(name || '音频') }, {
      play: () => invokeAction(mediaSessionActionsRef.current.play),
      pause: () => invokeAction(mediaSessionActionsRef.current.pause),
      seekBy: seconds => mediaSessionActionsRef.current.seekBy(seconds),
      seekTo: seconds => mediaSessionActionsRef.current.seekTo(seconds),
      ...(canPrev && onPrev ? { previous: () => mediaSessionActionsRef.current.previous?.() } : {}),
      ...(canNext && onNext ? { next: () => mediaSessionActionsRef.current.next?.() } : {}),
    }, { canSeek: duration > 0, canPrevious: !!canPrev && !!onPrev, canNext: !!canNext && !!onNext });
    return detach;
  }, [canNext, canPrev, duration, mediaSessionPort, name, onNext, onPrev, url]);
  useEffect(() => {
    if (!mediaSessionPort || !url) return;
    try { mediaSessionPort.setPlaybackState(mediaSessionPlaybackState); } catch { /* System media controls are optional. */ }
  }, [mediaSessionPlaybackState, mediaSessionPort, url]);

  const progressPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  return {
    media: input,
    playback: {
      paused,
      currentTime,
      duration,
      volume,
      loop,
      error,
      loading,
      progressPercent,
      currentTimeLabel: formatAudioPlaybackTime(currentTime),
      durationLabel: formatAudioPlaybackTime(duration),
    },
    actions: {
      attachAudioElement,
      togglePlayback,
      toggleLoop,
      setVolume,
      seekTo,
      onLoadedMetadata,
      onCanPlay,
      onTimeUpdate,
      onPlay,
      onPause,
      onWaiting,
      onPlaying,
      onError,
      onEnded,
    },
  };
}
