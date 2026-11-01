import type { MediaStateEvent } from '../../../../shared/player';
import type { PlaybackFailureStage } from '../../../../shared/playbackFailure';

/** Telemetry capability owned by playback; implementations live at the renderer boundary. */
export interface MediaDiagnosticsPort {
  report(event: MediaStateEvent): void | Promise<void>;
}

export interface HtmlMediaDiagnosticSnapshot {
  event: string;
  url: string;
  title?: string;
  readyState: number;
  currentTime: number;
  paused: boolean;
  mediaErrorCode?: number;
  networkState?: number;
  mediaErrorMessage?: string;
  failureStage?: PlaybackFailureStage;
  failureHttpStatus?: number;
  failureRetryable?: boolean;
  failureCode?: string;
}

export function createHtmlMediaDiagnosticEvent(snapshot: HtmlMediaDiagnosticSnapshot): MediaStateEvent {
  return {
    event: snapshot.event,
    kernel: 'html5',
    url: snapshot.url,
    title: snapshot.title,
    readyState: snapshot.readyState,
    currentTime: snapshot.currentTime,
    paused: snapshot.paused,
    ...(snapshot.mediaErrorCode == null ? {} : { mediaErrorCode: snapshot.mediaErrorCode }),
    ...(snapshot.networkState == null ? {} : { networkState: snapshot.networkState }),
    ...(snapshot.mediaErrorMessage ? { mediaErrorMessage: snapshot.mediaErrorMessage } : {}),
    ...(snapshot.failureStage ? { failureStage: snapshot.failureStage } : {}),
    ...(snapshot.failureHttpStatus == null ? {} : { failureHttpStatus: snapshot.failureHttpStatus }),
    ...(snapshot.failureRetryable == null ? {} : { failureRetryable: snapshot.failureRetryable }),
    ...(snapshot.failureCode ? { failureCode: snapshot.failureCode } : {}),
  };
}

/** Fire-and-forget telemetry is intentionally contained at this port boundary. */
export function reportHtmlMediaEvent(port: MediaDiagnosticsPort, snapshot: HtmlMediaDiagnosticSnapshot): void {
  const event = createHtmlMediaDiagnosticEvent(snapshot);
  void Promise.resolve().then(() => port.report(event)).catch(() => undefined);
}
