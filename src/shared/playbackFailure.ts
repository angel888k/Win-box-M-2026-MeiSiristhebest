export type PlaybackFailureStage =
  | 'startup'
  | 'authorization'
  | 'missing-media'
  | 'network'
  | 'demux'
  | 'decode'
  | 'engine'
  | 'unknown';

export type PlaybackFailureEngine = 'html5' | 'hls.js' | 'mpegts.js' | 'mpv' | 'external' | 'unknown';

/** Sanitized, machine-readable failure context shared by recovery and diagnostics. */
export interface PlaybackFailureContext {
  stage: PlaybackFailureStage;
  engine: PlaybackFailureEngine;
  httpStatus?: number;
  code?: string;
  retryable: boolean;
}

export interface PlaybackFailureInput {
  engine: PlaybackFailureEngine;
  reason?: string;
  httpStatus?: number;
  mediaErrorCode?: number;
  code?: string;
}

/** Classify common playback failures without retaining URLs, headers, or server bodies. */
export function classifyPlaybackFailure(input: PlaybackFailureInput): PlaybackFailureContext {
  const reason = String(input.reason || '').toLowerCase();
  const reasonStatus = reason.match(/\bhttp(?:\s+status)?\s+(\d{3})\b/);
  const candidateStatus = input.httpStatus ?? (reasonStatus ? Number(reasonStatus[1]) : undefined);
  const status = Number.isInteger(candidateStatus) && candidateStatus! >= 100 && candidateStatus! <= 599
    ? candidateStatus
    : undefined;
  const code = typeof input.code === 'string' && /^[a-z0-9_.:-]{1,48}$/i.test(input.code)
    ? input.code
    : undefined;
  let stage: PlaybackFailureStage = 'unknown';
  let retryable = false;

  if (/^(?:first-frame|startup)-timeout$/i.test(code || '') || /首帧.{0,8}超时/.test(reason)) {
    stage = 'startup';
    retryable = true;
  } else if (status === 401 || status === 403 || /unauthori[sz]ed|forbidden|token.{0,12}(?:expired|invalid)|签名.{0,6}过期|登录|权限/.test(reason)) {
    stage = 'authorization';
  } else if (status === 404 || status === 410) {
    stage = 'missing-media';
  } else if (status === 408 || status === 429 || (status != null && status >= 500)
    || input.mediaErrorCode === 2
    || /timeout|timed out|socket|connection|network|网络|超时|连接/.test(reason)) {
    stage = 'network';
    retryable = true;
  } else if (input.mediaErrorCode === 4 || /demux|container|playlist|manifest|解复用|播放清单/.test(reason)) {
    stage = 'demux';
  } else if (input.mediaErrorCode === 3 || /decode|decoder|codec|解码|编码/.test(reason)) {
    stage = 'decode';
  } else if (input.engine === 'mpv' || input.engine === 'external') {
    stage = 'engine';
  }

  return {
    stage,
    engine: input.engine,
    ...(status == null ? {} : { httpStatus: status }),
    ...(code ? { code } : {}),
    retryable,
  };
}

export function playbackFailureSummary(failure: PlaybackFailureContext): string {
  switch (failure.stage) {
    case 'startup': return '媒体响应已连接，但在限定时间内没有产生首帧';
    case 'authorization': return '源站要求登录或拒绝了当前访问权限';
    case 'missing-media': return '源站返回媒体不存在或链接已过期';
    case 'network': return '网络请求未能稳定取得媒体数据';
    case 'demux': return '播放内核无法识别媒体容器或播放清单';
    case 'decode': return '播放内核无法解码媒体数据';
    case 'engine': return '播放内核运行失败';
    default: return '播放器未能确认失败阶段';
  }
}
