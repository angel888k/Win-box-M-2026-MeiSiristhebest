import type { DanmakuCandidate, DanmakuSettings } from '../../../../shared/danmaku';
import type { MpvAudioTrack, MpvShaderRenderStatus, MpvSubtitleTrack, SrMode } from '../../../../shared/player';
import type { SrState } from '../../../../shared/plugin';
import type { PlayerEngineCapability } from '../../../../shared/plugin/playerEngine';
import type { SubtitleCandidate } from '../../../../shared/subtitle';
import type { PlayerFit } from '../application/playerPreferences';
import type { SuperResolutionFeedback } from '../application/superResolutionPort';
import type { SkipSeg } from '../application/skipSegments';
import type { Kernel, KernelPref } from '../../../lib/kernel';
import type { MpvTechnicalState } from './playerTechnicalState';
import type { DanmakuSettingsCommand } from '../application/danmakuSettings';
import type { SubtitleAppearanceCommand } from '../application/subtitleAppearance';
import type { SkipSegmentsDraft, SkipSegmentsDraftCommand } from '../application/skipSegmentsDraft';
import type { DlnaDevice } from '../../../../shared/dlna';
import type { ProgressMarker } from '../application/playerProgressGeometry';

/** Mutable DOM handle required by controls for positioning and focus. */
export interface ElementHandle<T> {
  current: T | null;
}

/** Pointer coordinates passed from a rendered control to its presenter. */
export interface PointerCoordinates {
  clientX: number;
  clientY: number;
}

export interface KernelChoice {
  id: Kernel;
  label: string;
  note?: string;
  /** Declared by a plugin engine; absent means the engine has no capability report. */
  capabilities?: readonly PlayerEngineCapability[];
}

export interface PlayerTransportModel {
  paused: boolean;
  canPrev?: boolean;
  canNext?: boolean;
  onPrev: () => void;
  onNext: () => void;
  onToggle: () => void;
}

export interface PlayerTechnicalBarModel {
  active: boolean;
  error: string;
  mpvTech: MpvTechnicalState | null;
  fmtNet: (value: number) => string;
}

export interface PlayerProgressBarModel {
  identity: string;
  markers?: readonly ProgressMarker[];
  chapters?: readonly ProgressMarker[];
  currentTime: number;
  duration: number;
  buffered: number;
  canSeek: () => boolean;
  getCurrentTime: () => number;
  seekTo: (seconds: number) => void;
  formatTime: (seconds: number) => string;
  onContextMenu: (position: PointerCoordinates, time: number | null) => boolean;
}

export interface PlayerSkipMenuModel {
  x: number;
  y: number;
  t: number;
}

export interface PlayerSkipMenuActions {
  setIntro: () => void;
  setOutro: () => void;
  clear: () => void;
  cancel: () => void;
}

export interface PlayerVolumeModel {
  volume: number;
  open: boolean;
  hidden: boolean;
  inputRef: ElementHandle<HTMLInputElement>;
  onFocusChange: (focused: boolean) => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onChange: (volume: number) => void;
  onPointerStart: () => void;
  onPointerEnd: () => void;
  onToggleMute: () => void;
}

export interface DlnaCastControlModel {
  open: boolean;
  busy: boolean;
  devices: readonly DlnaDevice[];
  message: string;
  onToggle: () => void;
  onRefresh: () => void;
  onCast: (device: DlnaDevice) => void | Promise<void>;
}

export interface SubtitlePanelModel {
  embeddedTracks?: MpvSubtitleTrack[];
  sid?: number | null;
  onSelectTrack?: (id: number) => void;
  enabled: boolean;
  open: boolean;
  activeSubtitle: string;
  fontSize: number;
  bottom: number;
  offset: number;
  query: string;
  searching: boolean;
  tokenHint: boolean;
  message: string;
  candidates: SubtitleCandidate[];
  resourceName?: string;
  panelRef: ElementHandle<HTMLDivElement>;
  onAnchorPointerEnter: () => void;
  onAnchorPointerLeave: () => void;
  onPanelPointerEnter: () => void;
  onPanelPointerLeave: () => void;
  onClose?: () => void;
  onToggle: () => void;
  onAppearanceCommand: (command: SubtitleAppearanceCommand) => void;
  onQueryChange: (value: string) => void;
  onRestoreQuery: () => void;
  onSearch: () => void;
  onSelectCandidate: (candidate: SubtitleCandidate) => void | Promise<void>;
}

export interface DanmakuPanelModel {
  enabled: boolean;
  enabledSourceCount: number;
  open: boolean;
  activeEpisodeId: number | null;
  message: string;
  settings: DanmakuSettings;
  candidates: DanmakuCandidate[];
  searching: boolean;
  query: string;
  episode: string;
  sourcesOpen: boolean;
  customText: string;
  panelRef: ElementHandle<HTMLDivElement>;
  onAnchorPointerEnter: () => void;
  onAnchorPointerLeave: () => void;
  onPanelPointerEnter: () => void;
  onPanelPointerLeave: () => void;
  onClose?: () => void;
  onToggle: () => void;
  onSettingsCommand: (command: DanmakuSettingsCommand) => void;
  onQueryChange: (value: string) => void;
  onEpisodeChange: (value: string) => void;
  onToggleSources: () => void;
  onCustomEndpointsTextChange: (text: string) => void;
  onSearch: () => void;
  onCandidateSelect: (candidate: DanmakuCandidate) => void | Promise<void>;
}

export interface SkipSegmentsControlModel {
  segments: SkipSeg;
  hasSegments: boolean;
  inheritedFrom: string | null;
  draft: SkipSegmentsDraft;
  open: boolean;
  onDraftCommand: (command: SkipSegmentsDraftCommand) => void;
  onToggle: () => void;
  onSave: () => void;
  onClear: () => void;
}

export interface PlayerSegmentLoopControlModel {
  available: boolean;
  active: boolean;
  open: boolean;
  start: number | null;
  end: number | null;
  currentTime: number;
  formatTime: (seconds: number) => string;
  onToggle: () => void;
  onClose: () => void;
  onSetStart: () => boolean;
  onSetEnd: () => boolean;
  onClear: () => void;
}

export interface PlaybackRateControlModel {
  rate: number;
  onRateChange: (rate: number) => void;
}

export interface KernelControlModel {
  kernel: Kernel;
  preference: KernelPref;
  choices: KernelChoice[];
  containerRef: ElementHandle<HTMLDivElement>;
  onSelect: (value: KernelPref) => void;
  onOpen: () => void;
}

export interface KernelToolsControlModel {
  statsOpen: boolean;
  onToggleStats: () => void;
  keysOpen: boolean;
  onToggleKeys: () => void;
}

export interface SuperResolutionControlModel {
  visible: boolean;
  active: boolean;
  mpvStatusResolved: boolean;
  mpvAvailable: boolean;
  capabilityLoading: boolean;
  capabilityError: string | null;
  info: SrState | null;
  mode: SrMode;
  feedback: SuperResolutionFeedback | null;
  renderStatus: MpvShaderRenderStatus | null;
  renderStatusLoading: boolean;
  renderStatusError: string | null;
  open: boolean;
  containerRef: ElementHandle<HTMLDivElement>;
  onOpen: () => void;
  onClose: () => void;
  onSwitchToMpv: () => void;
  onSelect: (mode: SrMode) => void;
}

export interface AudioTrackControlModel {
  spdif?: string;
  effectiveSpdif?: string;
  onSpdifChange?: (value: string) => void;
  open: boolean;
  tracks: MpvAudioTrack[];
  aid: number | null;
  isMpv: boolean;
  containerRef: ElementHandle<HTMLDivElement>;
  onOpen: () => void;
  onClose: () => void;
  onSelect: (track: MpvAudioTrack) => void;
}

export interface FitControlModel {
  fit: PlayerFit;
  open: boolean;
  onFitSelect: (fit: PlayerFit) => void;
  onFitOpen: () => void;
  onFitPointerEnter: () => void;
  onFitPointerLeave: () => void;
}

export interface EpisodeControlModel {
  open: boolean;
  onToggle: () => void;
}

export interface FullscreenControlModel {
  active: boolean;
  onToggle: () => void;
}
