import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from 'react';
import type HlsInstance from 'hls.js';
import type MpegtsModule from 'mpegts.js';
import type { Kernel } from '../../lib/kernel';
import type { PlaybackSourceRef } from '../../lib/playbackProgress';
import { resolvePlayTarget } from '../../lib/playTarget';
import { detectMediaKind } from '../../lib/mediaKind';
import type { PlayerPrefs } from './application/playerPreferences';
import type { PlaybackPositionMemoryPort, PlaybackRuntimePort } from './application/playbackSessionPorts';
import type { PlaybackSessionStatePort } from './application/playbackSessionState';
import { resolveResumePosition } from './resumePosition';
import { createHtml5PlaybackTimeline } from './html5PlaybackTimeline';
import { hlsErrorText } from './hlsErrorText';
import { createHtml5PlaybackRecovery, type Html5HlsFailureType } from './application/html5PlaybackRecovery';
import { reportHtmlMediaEvent, type MediaDiagnosticsPort } from './application/mediaDiagnostics';
import type { PlaybackHandoffPort } from './application/playbackHandoff';
import type { PlayerPlaybackPresentationUpdate } from './application/PlayerPlaybackPresentation';
import type { AdaptiveAudioTrackController } from './application/playerAudioTracks';
import {
  liveHlsLatencyConfig,
  measureLiveEdgeLatency,
  shouldApplyLiveBufferConfig,
  supportsLowLatencyHls,
  type LiveLatencyMode,
} from './application/livePlaybackPolicy';
import { createHlsAudioTrackControllerAdapter } from './adapters/hlsAudioTrackControllerAdapter';
import { classifyPlaybackFailure, type PlaybackFailureContext } from '../../../shared/playbackFailure';

const VOD_FIRST_FRAME_TIMEOUT_MS = 12_000;
const LIVE_FIRST_FRAME_TIMEOUT_MS = 45_000;

export interface Html5PlaybackSessionOptions {
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  adaptiveAudioTracksRef?: MutableRefObject<AdaptiveAudioTrackController | null>;
  resourceName?: string;
  onAudioTracks?: () => void;
  url: string;
  htmlUrl: string;
  progressKey: string;
  kernel: Kernel;
  isImage: boolean;
  isAudio: boolean;
  liveHint: boolean;
  liveLatencyMode?: LiveLatencyMode;
  onLivePlaybackTelemetry?: (telemetry: { isLive: boolean | null; latencySeconds: number | null; lowLatencySupported: boolean | null }) => void;
  playbackSource?: PlaybackSourceRef;
  positionMemory: PlaybackPositionMemoryPort;
  runtime: PlaybackRuntimePort;
  startTime?: number;
  prefsRef: MutableRefObject<PlayerPrefs | null>;
  bossActiveRef: MutableRefObject<boolean>;
  sessionState: PlaybackSessionStatePort;
  handoff: PlaybackHandoffPort;
  updatePlaybackStatus(update: PlayerPlaybackPresentationUpdate): void;
  clearAuto(): void;
  revealControls(): void;
  recoverHtmlPlayback(): boolean;
  onPlaybackFailure?(currentTime: number, reason: string, failure?: PlaybackFailureContext): void;
  onPlaybackStarted?(): void;
  tryExternalFallback?(sourceUrl: string, position: number): Promise<{ opened: boolean; player?: string; error?: string } | null>;
  handlePlaybackEnd(): void;
  canAdvance(): boolean;
  advance(): void;
  showSkipToast(message: string): void;
  formatTime(seconds: number): string;
}

/** Owns the HTML media element, HLS/FLV engines, event listeners and their cleanup. */
export function useHtml5PlaybackSession(options: Html5PlaybackSessionOptions, mediaDiagnostics: MediaDiagnosticsPort): void {
  const hlsInstanceRef = useRef<HlsInstance | null>(null);
  const localAdaptiveAudioTracksRef = useRef<AdaptiveAudioTrackController | null>(null);
  const adaptiveAudioTracksRef = options.adaptiveAudioTracksRef ?? localAdaptiveAudioTracksRef;
  const audioTracksRef = useRef(options.onAudioTracks);
  useLayoutEffect(() => { audioTracksRef.current = options.onAudioTracks; }, [options.onAudioTracks]);
  const liveTelemetryRef = useRef(options.onLivePlaybackTelemetry);
  useLayoutEffect(() => { liveTelemetryRef.current = options.onLivePlaybackTelemetry; }, [options.onLivePlaybackTelemetry]);
  const liveLatencyModeRef = useRef(options.liveLatencyMode || 'stable');
  const livePlaylistStateRef = useRef<{ isLive: boolean; lowLatencySupported: boolean } | null>(null);
  useLayoutEffect(() => {
    liveLatencyModeRef.current = options.liveLatencyMode || 'stable';
    const hls = hlsInstanceRef.current;
    const playlist = livePlaylistStateRef.current;
    if (!hls || !playlist?.isLive) return;
    const mode = liveLatencyModeRef.current === 'low-latency' && playlist.lowLatencySupported
      ? 'low-latency' : 'stable';
    Object.assign(hls.config, liveHlsLatencyConfig(mode));
  }, [options.liveLatencyMode]);
  const {
    videoRef,
    url,
    htmlUrl,
    progressKey,
    kernel,
    isImage,
    isAudio,
    liveHint,
    playbackSource,
    positionMemory,
    runtime,
    startTime,
    prefsRef,
    bossActiveRef,
    sessionState,
    handoff,
    updatePlaybackStatus,
    clearAuto,
    revealControls,
    recoverHtmlPlayback,
    onPlaybackFailure,
    onPlaybackStarted,
    tryExternalFallback,
    handlePlaybackEnd,
    canAdvance,
    advance,
    showSkipToast,
    formatTime,
  } = options;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url || !htmlUrl || isImage || isAudio || kernel !== 'html5') return;

    updatePlaybackStatus({ error: '', mpvError: '', loading: true, paused: true, currentTime: 0, duration: 0, isLive: liveHint });
    sessionState.setLivePlaybackKind(liveHint);
    updatePlaybackStatus({ netSpeed: null, relaySpeed: null, buffering: false });

    if (prefsRef.current) {
      video.volume = prefsRef.current.vol;
      video.playbackRate = prefsRef.current.rate;
    }
    video.removeAttribute('src');
    hlsInstanceRef.current?.destroy();
    hlsInstanceRef.current = null;
    adaptiveAudioTracksRef.current = null;
    const oldFlv = (video as unknown as { __flv?: MpegtsModule.Player }).__flv;
    if (oldFlv) {
      try {
        oldFlv.destroy();
      } catch {
        /* Ignore an engine teardown failure. */
      }
    }
    (video as unknown as { __flv?: MpegtsModule.Player }).__flv = undefined;

    const target = resolvePlayTarget(htmlUrl).toLowerCase().split('?')[0];
    let speedTimer: ReturnType<typeof setInterval> | null = null;
    let hlsOffline = false;
    let resumeAfterNetworkRecovery = false;
    let hlsNetworkHandlers: { offline: () => void; online: () => void } | null = null;
    let cancelled = false;
    let terminalFailureReported = false;
    const recovery = createHtml5PlaybackRecovery();
    let playbackConfirmed = false;
    let playbackFramePending = false;
    let playbackFrameAttempt = 0;
    let playbackFrameCallbackId: number | null = null;
    let playbackRafId: number | null = null;
    let firstFrameTimer: ReturnType<typeof setTimeout> | null = null;
    const clearFirstFrameTimer = () => {
      if (firstFrameTimer) clearTimeout(firstFrameTimer);
      firstFrameTimer = null;
    };
    const reportTerminalFailure = (message: string, reason: string, failure?: PlaybackFailureContext) => {
      if (terminalFailureReported || cancelled) return;
      terminalFailureReported = true;
      clearFirstFrameTimer();
      updatePlaybackStatus({ error: message, loading: false });
      const context = failure || classifyPlaybackFailure({ engine: 'unknown', reason });
      onPlaybackFailure?.(Math.max(0, video.currentTime || 0), reason, context);
    };
    const armFirstFrameTimer = (timeoutMs = sessionState.getLivePlaybackKind() ? LIVE_FIRST_FRAME_TIMEOUT_MS : VOD_FIRST_FRAME_TIMEOUT_MS) => {
      if (cancelled || playbackConfirmed || firstFrameTimer) return;
      firstFrameTimer = setTimeout(() => {
        firstFrameTimer = null;
        if (cancelled || playbackConfirmed || video.paused) return;
        reportTerminalFailure(
          `播放请求已发出，但 ${Math.round(timeoutMs / 1000)} 秒内没有显示视频画面。可检查线路权限，或等待自动查找同集备用源。`,
          'first-frame-timeout',
          { stage: 'startup', engine: 'html5', code: 'first-frame-timeout', retryable: true },
        );
      }, timeoutMs);
    };
    const confirmRenderedFrame = (attempt: number) => {
      if (attempt !== playbackFrameAttempt) return;
      playbackFramePending = false;
      playbackFrameCallbackId = null;
      if (cancelled || playbackConfirmed || video.paused) return;
      playbackConfirmed = true;
      clearFirstFrameTimer();
      onPlaybackStarted?.();
    };
    let previousBytes = -1;
    let previousTime = 0;
    const reportKiloBytesPerSecond = (speed: number) => {
      if (Number.isFinite(speed) && speed > 0) updatePlaybackStatus({ netSpeed: speed });
    };
    const handoffTarget = { url, progressKey, kernel } as const;
    const currentHandoff = () => handoff.readFor(handoffTarget);
    const timeline = createHtml5PlaybackTimeline({
      media: video,
      getResumePosition: () => resolveResumePosition({
        kernelPosition: currentHandoff()?.position ?? 0,
        startTime,
        storedPosition: positionMemory.read(url, playbackSource),
      }),
      getPreRestorePosition: () => resolveResumePosition({
        kernelPosition: 0,
        startTime,
        storedPosition: positionMemory.read(url, playbackSource),
      }),
      onResumePositionApplied: () => {
        handoff.markPositionApplied(handoffTarget);
      },
      getSegments: () => sessionState.getSkipSegments(),
      isLive: () => sessionState.getLivePlaybackKind(),
      introFired: {
        wasHandled: sessionState.wasIntroSkipHandled,
        markHandled: sessionState.markIntroSkipHandled,
      },
      outroFired: {
        wasHandled: sessionState.wasOutroSkipHandled,
        markHandled: sessionState.markOutroSkipHandled,
      },
      setCurrentTime: (value) => updatePlaybackStatus({ currentTime: value }),
      savePosition: (time) => positionMemory.save(url, time, playbackSource),
      canAdvance,
      advance,
      showToast: showSkipToast,
      formatTime,
    });
    const onTime = timeline.onTimeUpdate;
    const onCanPlay = () => {
      if (!bossActiveRef.current && prefsRef.current) {
        if (video.volume !== prefsRef.current.vol) video.volume = prefsRef.current.vol;
        if (video.playbackRate !== prefsRef.current.rate) video.playbackRate = prefsRef.current.rate;
      }
       updatePlaybackStatus({ loading: false });
      timeline.maybeSkip();
    };
    const onDuration = () => {
      const duration = video.duration;
      updatePlaybackStatus({ duration: Number.isFinite(duration) ? duration : 0, isLive: sessionState.getLivePlaybackKind() || duration === Infinity });
      timeline.onDurationReady();
    };
    const onPlay = () => {
      updatePlaybackStatus({ paused: false, buffering: false });
      armFirstFrameTimer();
      clearAuto();
      revealControls();
    };
    const onPause = () => {
      if (hlsOffline) resumeAfterNetworkRecovery = false;
      updatePlaybackStatus({ paused: true });
      clearFirstFrameTimer();
      playbackFrameAttempt += 1;
      playbackFramePending = false;
      if (playbackFrameCallbackId != null && typeof video.cancelVideoFrameCallback === 'function') {
        video.cancelVideoFrameCallback(playbackFrameCallbackId);
      }
      playbackFrameCallbackId = null;
      if (playbackRafId != null) cancelAnimationFrame(playbackRafId);
      playbackRafId = null;
      revealControls();
    };
    const onWaiting = () => updatePlaybackStatus({ buffering: true });
    const onPlaying = () => {
      updatePlaybackStatus({ buffering: false });
      if (playbackConfirmed || playbackFramePending) return;
      playbackFramePending = true;
      const attempt = ++playbackFrameAttempt;
      if (typeof video.requestVideoFrameCallback === 'function') {
        playbackFrameCallbackId = video.requestVideoFrameCallback(() => confirmRenderedFrame(attempt));
      } else {
        // Older Chromium fallback: wait for a composited frame after the media
        // element reports data, instead of treating URL resolution/`playing`
        // alone as proof that the viewer saw a frame.
        playbackRafId = requestAnimationFrame(() => {
          playbackRafId = null;
          if (attempt !== playbackFrameAttempt) return;
          if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) confirmRenderedFrame(attempt);
          else playbackFramePending = false;
        });
      }
    };
    const onError = () => {
      const mediaError = video.error;
      if (recovery.shouldIgnoreMediaError(mediaError?.code ?? 0)) return;
      const decision = recovery.onMediaError({
        code: mediaError?.code ?? 0,
        kernelRecoveryStarted: recoverHtmlPlayback(),
        externalFallbackAvailable: !!tryExternalFallback,
      });
      if (decision.kind === 'ignore') return;
      clearFirstFrameTimer();
      const reason = mediaError?.code === 2
        ? '网络读取失败，源站可能拒绝连接或链接已失效'
        : mediaError?.code === 3
          ? '视频解码失败，可能是编码不兼容或媒体数据损坏'
          : mediaError?.code === 4
            ? '内置播放器无法识别该媒体响应：可能是源站返回了网页/文字，也可能是编码或播放清单不受当前内核支持'
            : mediaError?.code === 1
              ? '播放请求已中止'
              : '视频加载失败或源不可用';
      const nativeMessage = mediaError?.message?.replace(/\s+/g, ' ').trim().slice(0, 160);
      const redundantFormatCode = mediaError?.code === 4 && /MEDIA_ELEMENT_ERROR:\\s*Format error/i.test(nativeMessage || '');
      const errorMessage = `播放出错：${reason}${nativeMessage && !redundantFormatCode ? `（技术信息：${nativeMessage}）` : ''}`;
      updatePlaybackStatus({ loading: false });
      const failure = classifyPlaybackFailure({ engine: 'html5', reason: nativeMessage || reason, mediaErrorCode: mediaError?.code });
      // When the user has explicitly enabled an external player, hand formats
      // Chromium cannot demux (for example HEVC/MKV or a source-specific stream)
      // to that player using the same local proxy URL and current seek position.
      // A single attempt per media session avoids duplicate launches from repeated
      // Chromium error events.
      if (decision.kind === 'try-external-player' && tryExternalFallback) {
        void tryExternalFallback(htmlUrl || url, Math.max(0, video.currentTime || 0)).then((result) => {
          const completion = recovery.completeExternalFallback(result);
          if (completion.kind === 'ignore') return;
          if (completion.kind === 'external-player-opened') {
          updatePlaybackStatus({ error: `内置播放器无法解析此媒体，已启动${completion.player || '外部播放器'}；请在播放器窗口确认播放状态。` });
            return;
          }
          const message = completion.error ? `${errorMessage}（外部播放器启动失败：${completion.error}）` : errorMessage;
          reportTerminalFailure(message, completion.error || nativeMessage || reason, { ...failure, engine: 'external' });
        }).catch((error) => {
          const detail = error instanceof Error ? error.message : String(error);
          const completion = recovery.completeExternalFallback({ opened: false, error: detail });
          if (completion.kind === 'ignore') return;
          reportTerminalFailure(`${errorMessage}（外部播放器启动失败：${detail}）`, detail, { ...failure, engine: 'external' });
        });
        return;
      }
      reportTerminalFailure(errorMessage, nativeMessage || reason, failure);
    };
    const onEnded = () => handlePlaybackEnd();

    video.addEventListener('timeupdate', onTime);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('durationchange', onDuration);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('error', onError);
    video.addEventListener('ended', onEnded);

    const start = () => {
      if (currentHandoff()?.paused) {
        updatePlaybackStatus({ paused: true });
        return;
      }
      armFirstFrameTimer();
      video.play().then(() => updatePlaybackStatus({ paused: false })).catch(() => undefined);
    };

    if (detectMediaKind(htmlUrl) === 'hls') {
      // Electron/Chromium may report "maybe" for Apple's HLS MIME type even
      // though its media pipeline cannot demux HLS. In the desktop app, always
      // let hls.js load manifests and segments through the supported MSE path.
      const desktopRuntime = runtime.isDesktopRuntime();
      if (!desktopRuntime && video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = htmlUrl;
        start();
      } else {
        void import('hls.js').then(({ default: Hls }) => {
          if (cancelled) return;
          if (!Hls.isSupported()) {
            updatePlaybackStatus({ error: '当前环境不支持 HLS 播放', loading: false });
            return;
          }
          const hls = new Hls({
            maxBufferLength: 20,
            maxMaxBufferLength: 60,
            maxBufferSize: 30 * 1000 * 1000,
            backBufferLength: 30,
            enableWorker: true,
            manifestLoadingTimeOut: 12000,
            levelLoadingTimeOut: 15000,
            fragLoadingTimeOut: 20000,
            manifestLoadingMaxRetry: 2,
            manifestLoadingRetryDelay: 600,
            levelLoadingMaxRetry: 2,
            fragLoadingMaxRetry: 2,
            fragLoadingRetryDelay: 600,
          });
          hlsInstanceRef.current = hls;
          const onNetworkOffline = () => {
            if (cancelled) return;
            if (!hlsOffline) resumeAfterNetworkRecovery = !video.paused;
            hlsOffline = true;
            updatePlaybackStatus({
              error: '网络已断开，当前播放会等待网络恢复后继续。',
              loading: false,
              buffering: resumeAfterNetworkRecovery,
            });
          };
          const onNetworkOnline = () => {
            if (cancelled || !hlsOffline) return;
            hlsOffline = false;
            updatePlaybackStatus({ error: '', loading: true, buffering: true });
            try { hls.startLoad(Math.max(0, video.currentTime || 0)); } catch { /* HLS may already be loading after reconnection. */ }
            if (resumeAfterNetworkRecovery) {
              resumeAfterNetworkRecovery = false;
              void video.play().catch(() => undefined);
            }
          };
          hlsNetworkHandlers = { offline: onNetworkOffline, online: onNetworkOnline };
          if (typeof window !== 'undefined') {
            window.addEventListener('offline', onNetworkOffline);
            window.addEventListener('online', onNetworkOnline);
          }
          if (typeof navigator !== 'undefined' && navigator.onLine === false) onNetworkOffline();
          livePlaylistStateRef.current = null;
          const audioTrackController = createHlsAudioTrackControllerAdapter(hls);
          adaptiveAudioTracksRef.current = audioTrackController;
          hls.loadSource(htmlUrl);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => { start(); audioTracksRef.current?.(); });
          hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => audioTracksRef.current?.());
          hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, () => audioTracksRef.current?.());
          hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
            const details = (data as unknown as { details?: { live?: boolean; edge?: number; partTarget?: number } }).details;
            const live = !!details?.live;
            sessionState.setLivePlaybackKind(live);
            // A stream can be identified as live only after its playlist loads.
            // If the initial hint was missing, extend the VOD startup deadline
            // instead of prematurely failing a legitimate live stream.
            if (live && !playbackConfirmed && firstFrameTimer) {
              clearFirstFrameTimer();
              armFirstFrameTimer(LIVE_FIRST_FRAME_TIMEOUT_MS);
            }
            updatePlaybackStatus({ isLive: live });
            if (!shouldApplyLiveBufferConfig({ liveHint, playlistIsLive: live })) {
              livePlaylistStateRef.current = { isLive: false, lowLatencySupported: false };
              liveTelemetryRef.current?.({ isLive: false, latencySeconds: null, lowLatencySupported: false });
              return;
            }
            const lowLatencySupported = supportsLowLatencyHls({ isLive: live, partTarget: details?.partTarget });
            livePlaylistStateRef.current = { isLive: true, lowLatencySupported };
            const mode = liveLatencyModeRef.current;
            // Do not touch playback tuning until the playlist proves it is live.
            // LL-HLS tuning additionally requires an explicit PART-TARGET.
            Object.assign(hls.config, liveHlsLatencyConfig(mode === 'low-latency' && lowLatencySupported ? mode : 'stable'));
            liveTelemetryRef.current?.({
              isLive: true,
              latencySeconds: measureLiveEdgeLatency({
                isLive: live,
                engine: 'hls.js',
                currentTime: video.currentTime,
                liveEdge: details?.edge,
              }),
              lowLatencySupported,
            });
          });
          hls.on(Hls.Events.FRAG_LOADED, (_event, data) => {
            const { loading, loaded } = data.frag.stats;
            const durationMs = loading.end - loading.start;
            if (Number.isFinite(durationMs) && durationMs > 0 && loaded > 0) {
              reportKiloBytesPerSecond(loaded / 1024 / (durationMs / 1000));
            }
          });
          hls.on(Hls.Events.ERROR, (_event, data) => {
            if (!data.fatal || !recovery.isActive()) return;
            const responseStatus = data.response?.code;
            const errorType: Html5HlsFailureType = data.type === Hls.ErrorTypes.NETWORK_ERROR
              ? 'network'
              : data.type === Hls.ErrorTypes.MEDIA_ERROR
                ? 'media'
                : 'other';
            if (errorType === 'network' && (hlsOffline || (typeof navigator !== 'undefined' && navigator.onLine === false))) {
              onNetworkOffline();
              return;
            }
            const decision = recovery.onHlsFatal({ type: errorType, responseStatus });
            if (decision.kind === 'ignore') return;
            const failure = classifyPlaybackFailure({
              engine: 'hls.js',
              reason: data.details,
              httpStatus: responseStatus,
              code: data.details,
            });
            reportHtmlMediaEvent(mediaDiagnostics, {
              event: 'hls-fatal:' + data.type + ':' + data.details,
              url: htmlUrl,
              title: options.resourceName,
              readyState: video.readyState,
              currentTime: video.currentTime,
              paused: video.paused,
              failureStage: failure.stage,
              failureHttpStatus: failure.httpStatus,
              failureRetryable: failure.retryable,
              failureCode: failure.code,
            });
            if (decision.kind === 'retry-network') {
              updatePlaybackStatus({ error: '' });
              try { hls.startLoad(); } catch { /* Ignore a failed retry request. */ }
              return;
            }
            if (decision.kind === 'recover-media') {
              updatePlaybackStatus({ error: '' });
              try { hls.recoverMediaError(); } catch { /* Ignore a failed recovery request. */ }
              return;
            }
            if (decision.kind === 'switch-kernel' && recoverHtmlPlayback()) return;
            const retries = decision.retryCount ?? 0;
            const reason = hlsErrorText(data.type, data.details, responseStatus, data.response?.data);
            reportTerminalFailure(`HLS 播放失败：${reason}` + (retries ? `（已自动重试 ${retries} 次）` : ''), reason, failure);
          });
        }).catch(() => {
          if (cancelled) return;
          if (recoverHtmlPlayback()) return;
          reportTerminalFailure('HLS 播放组件加载失败', 'hls-component-load');
        });
      }
    } else if (target.endsWith('.flv') || target.endsWith('.ts') || /mpegts/.test(target)) {
      void import('mpegts.js').then(({ default: mpegts }) => {
        if (cancelled) return;
        if (!mpegts.isSupported()) {
          if (recoverHtmlPlayback()) return;
          reportTerminalFailure('当前环境不支持 FLV 播放', 'mpegts-unsupported');
          return;
        }
        const isFlv = target.endsWith('.flv') || /mpegts/.test(target);
        const player = mpegts.createPlayer({
          type: isFlv ? 'flv' : 'mpegts',
          url: htmlUrl,
          isLive: isFlv || /live/i.test(target),
        });
        (video as unknown as { __flv?: MpegtsModule.Player }).__flv = player;
        player.attachMediaElement(video);
        player.load();
        player.on(mpegts.Events.STATISTICS_INFO, (info: { currentSpeed?: number }) => {
          if (info?.currentSpeed != null && info.currentSpeed > 0) reportKiloBytesPerSecond(info.currentSpeed);
        });
        player.on(mpegts.Events.ERROR, (type: string, detail: string, info: unknown) => {
          if (cancelled || recoverHtmlPlayback()) return;
          const reason = [type, detail, typeof info === 'string' ? info : ''].filter(Boolean).join(': ').slice(0, 180);
          const failure = classifyPlaybackFailure({ engine: 'mpegts.js', reason: reason || 'media stream demux failure', code: type });
          reportTerminalFailure(`MPEG-TS 播放失败：${reason || '媒体流读取或解复用失败'}`, reason || 'mpegts-error', failure);
        });
        const keepPaused = currentHandoff()?.paused;
        if (keepPaused) {
          updatePlaybackStatus({ paused: true });
        } else {
          armFirstFrameTimer();
          try { player.play(); } catch { /* Ignore autoplay refusal. */ }
          updatePlaybackStatus({ paused: false });
        }
      }).catch(() => {
        if (cancelled) return;
        if (recoverHtmlPlayback()) return;
        reportTerminalFailure('MPEG-TS 播放组件加载失败', 'mpegts-component-load');
      });
    } else {
      const targetPrefix = url.split('?')[0];
      speedTimer = setInterval(() => {
        let bytes = 0;
        try {
          for (const entry of performance.getEntriesByType('resource')) {
            const resource = entry as PerformanceResourceTiming;
            if (!resource?.name) continue;
            if (resource.name !== url && !resource.name.startsWith(targetPrefix)) continue;
            const transferred = Number.isFinite(resource.transferSize) && resource.transferSize > 0
              ? resource.transferSize
              : Number.isFinite(resource.encodedBodySize) && resource.encodedBodySize > 0
                ? resource.encodedBodySize
                : 0;
            bytes += transferred;
          }
        } catch {
          /* Resource Timing may be unavailable for a media URL. */
        }
        if (bytes > 0 && bytes !== previousBytes) {
          const now = performance.now();
          if (previousBytes >= 0 && previousTime > 0) {
            const elapsedSeconds = (now - previousTime) / 1000;
            const speed = (bytes - previousBytes) / 1024 / (elapsedSeconds > 0 ? elapsedSeconds : 1);
            if (speed > 0 && speed < 1024 * 1024) reportKiloBytesPerSecond(speed);
          }
          previousBytes = bytes;
          previousTime = now;
        }
      }, 600);
      video.src = htmlUrl;
      start();
    }

    return () => {
      cancelled = true;
      recovery.cancel();
      clearFirstFrameTimer();
      playbackFrameAttempt += 1;
      if (playbackFrameCallbackId != null && typeof video.cancelVideoFrameCallback === 'function') {
        video.cancelVideoFrameCallback(playbackFrameCallbackId);
      }
      if (playbackRafId != null) cancelAnimationFrame(playbackRafId);
      if (speedTimer) clearInterval(speedTimer);
      if (hlsNetworkHandlers && typeof window !== 'undefined') {
        window.removeEventListener('offline', hlsNetworkHandlers.offline);
        window.removeEventListener('online', hlsNetworkHandlers.online);
      }
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('durationchange', onDuration);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('error', onError);
      video.removeEventListener('ended', onEnded);
      clearAuto();
      if (!video.paused) positionMemory.save(url, video.currentTime, playbackSource);
      video.pause();
      const hlsInstance = hlsInstanceRef.current;
      hlsInstanceRef.current = null;
      livePlaylistStateRef.current = null;
      if (hlsInstance) {
        if (adaptiveAudioTracksRef.current) adaptiveAudioTracksRef.current = null;
        hlsInstance.destroy();
      }
      const flv = (video as unknown as { __flv?: MpegtsModule.Player }).__flv;
      if (flv) {
        try { flv.destroy(); } catch { /* Ignore an engine teardown failure. */ }
      }
      (video as unknown as { __flv?: MpegtsModule.Player }).__flv = undefined;
      video.removeAttribute('src');
      video.load();
    };
    // Keep the existing session boundary: URL, kernel, prepared URL, and playback source changes restart the HTML5 session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, kernel, htmlUrl, progressKey, positionMemory, runtime, liveHint]);
}
