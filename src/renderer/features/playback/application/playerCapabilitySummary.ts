import type { PlayerEngineCapability } from '../../../../shared/plugin/playerEngine';

/** Host-integrated built-in controls; these are explicit contracts, not name-based guesses. */
export const HTML5_PLAYER_CAPABILITIES: readonly PlayerEngineCapability[] = ['seek', 'rate', 'subtitle', 'fit'];
export const MPV_PLAYER_CAPABILITIES: readonly PlayerEngineCapability[] = ['seek', 'rate', 'tracks', 'subtitle', 'fit'];

export type CapabilityState = 'available' | 'unavailable' | 'unknown';
export type SuperResolutionState = 'active' | 'available' | 'unavailable' | 'unknown';

export interface PlayerCapabilitySummaryInput {
  engineLabel: string;
  /** A missing capability list means the engine has not reported a contract. */
  declaredCapabilities?: readonly PlayerEngineCapability[];
  /** Per-capability facts that are session-dependent in the host integration. */
  capabilityOverrides?: Partial<Record<PlayerEngineCapability, CapabilityState>>;
  engineReady?: boolean;
  /** Render-pipeline feedback is separate from the engine capability declaration. */
  superResolution: SuperResolutionState;
  superResolutionDetail?: string;
  /** null means this media session has not reported track enumeration yet. */
  audioTrackCount: number | null;
  subtitleTrackCount: number | null;
  /** Current decoded video dimensions, when the playback surface reported them. */
  resolution?: string | null;
}

/** Returns readiness only from the active media element or MPV file-loaded event. */
export function observePlayerReadiness(input: {
  kernel: 'html5' | 'mpv' | `engine:${string}`;
  htmlReadyState?: number | null;
  mpvLoaded?: boolean | null;
}): boolean | undefined {
  if (input.kernel === 'html5') {
    return Number.isFinite(input.htmlReadyState) ? Number(input.htmlReadyState) >= 2 : undefined;
  }
  if (input.kernel === 'mpv') return typeof input.mpvLoaded === 'boolean' ? input.mpvLoaded : undefined;
  return undefined;
}

/** Runtime evidence is separate from engine branding and command acknowledgements. */
export function resolveSuperResolutionState(input: {
  kernel: 'html5' | 'mpv' | `engine:${string}`;
  pluginAvailable?: boolean;
  renderState?: 'disabled' | 'no-session' | 'unavailable' | 'unsupported' | 'waiting-for-frame' | 'unidentifiable' | 'not-observed' | 'observed' | null;
}): SuperResolutionState {
  if (input.kernel !== 'mpv') return 'unavailable';
  if (input.renderState === 'observed') return 'active';
  if (input.renderState === 'not-observed' || input.renderState === 'unsupported' || input.renderState === 'unavailable' || input.renderState === 'disabled') return 'unavailable';
  if (input.pluginAvailable === false) return 'unavailable';
  return input.pluginAvailable === true ? 'available' : 'unknown';
}

export interface PlayerCapabilityRow {
  id: 'seek' | 'rate' | 'tracks' | 'subtitle' | 'fit' | 'resolution' | 'super-resolution';
  label: string;
  state: CapabilityState;
  statusLabel: string;
  detail: string;
}

export interface PlayerCapabilitySummary {
  engineLabel: string;
  readiness: 'ready' | 'not-ready' | 'unknown';
  rows: PlayerCapabilityRow[];
}

function declaredState(
  declaredCapabilities: readonly PlayerEngineCapability[] | undefined,
  capability: PlayerEngineCapability,
): CapabilityState {
  if (declaredCapabilities === undefined) return 'unknown';
  return declaredCapabilities.includes(capability) ? 'available' : 'unavailable';
}

function stateDetail(state: CapabilityState): string {
  switch (state) {
    case 'available': return '内核已声明支持';
    case 'unavailable': return '内核已声明不支持';
    default: return '内核尚未报告';
  }
}

function stateLabel(state: CapabilityState): string {
  switch (state) {
    case 'available': return '已声明支持';
    case 'unavailable': return '已声明不支持';
    default: return '未报告';
  }
}

function capabilityState(input: PlayerCapabilitySummaryInput, capability: PlayerEngineCapability): CapabilityState {
  return input.capabilityOverrides?.[capability] ?? declaredState(input.declaredCapabilities, capability);
}

/**
 * Build a truthful capability projection. It distinguishes declared engine support
 * from per-session observations and never treats a missing declaration as failure.
 */
export function projectPlayerCapabilitySummary(input: PlayerCapabilitySummaryInput): PlayerCapabilitySummary {
  const { audioTrackCount, subtitleTrackCount } = input;
  const seekState = capabilityState(input, 'seek');
  const rateState = capabilityState(input, 'rate');
  const fitState = capabilityState(input, 'fit');
  const subtitleState = capabilityState(input, 'subtitle');
  const tracksState = capabilityState(input, 'tracks');
  const rows: PlayerCapabilityRow[] = [
    { id: 'seek', label: '进度拖动', state: seekState, statusLabel: stateLabel(seekState), detail: stateDetail(seekState) },
    { id: 'rate', label: '播放倍速', state: rateState, statusLabel: stateLabel(rateState), detail: stateDetail(rateState) },
    { id: 'fit', label: '画面适配', state: fitState, statusLabel: stateLabel(fitState), detail: stateDetail(fitState) },
    { id: 'subtitle', label: '字幕', state: subtitleState, statusLabel: stateLabel(subtitleState), detail: stateDetail(subtitleState) },
    {
      id: 'tracks', label: '音视频轨道',
      state: tracksState,
      statusLabel: audioTrackCount !== null || subtitleTrackCount !== null ? '本次已枚举' : stateLabel(tracksState),
      detail: audioTrackCount === null && subtitleTrackCount === null
        ? stateDetail(tracksState)
        : `本次播放已观察到 ${audioTrackCount === null ? '音轨数未报告' : `${audioTrackCount} 条音轨`}；${subtitleTrackCount === null ? '内嵌字幕数未报告' : `${subtitleTrackCount} 条内嵌字幕`}`,
    },
    {
      id: 'resolution', label: '当前分辨率',
      state: input.resolution ? 'available' : 'unknown',
      statusLabel: input.resolution ? '已报告' : '未报告',
      detail: input.resolution || '播放画面尚未报告尺寸',
    },
    {
      id: 'super-resolution', label: '超分着色器',
      state: input.superResolution === 'active' || input.superResolution === 'available'
        ? 'available'
        : input.superResolution === 'unavailable' ? 'unavailable' : 'unknown',
      statusLabel: input.superResolution === 'active'
        ? '已观察到运行'
        : input.superResolution === 'available'
          ? '可用，未验证'
          : input.superResolution === 'unavailable' ? '当前不可用' : '状态未知',
      detail: input.superResolution === 'active'
        ? '本次渲染管线已观察到所选着色器'
        : input.superResolution === 'available'
          ? input.superResolutionDetail || '当前播放路径提供超分；本次尚未确认着色器正在运行'
          : input.superResolution === 'unavailable'
            ? input.superResolutionDetail || '当前播放路径不支持，或已确认超分不可用'
            : input.superResolutionDetail || '本次播放尚未验证渲染状态',
    },
  ];

  return {
    engineLabel: input.engineLabel,
    readiness: input.engineReady === undefined ? 'unknown' : input.engineReady ? 'ready' : 'not-ready',
    rows,
  };
}

