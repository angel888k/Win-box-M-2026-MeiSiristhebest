import type { PlaybackPositionScope } from './playbackSessionPorts';

export interface AudioPlayerInput {
  url: string;
  playbackSource?: PlaybackPositionScope;
  name?: string;
  cover?: string;
  index?: number;
  total?: number;
  canPrev?: boolean;
  canNext?: boolean;
  onPrev?: () => void;
  onNext?: () => void;
  onPlaybackStarted?: () => void;
  startTime?: number;
  mini?: boolean;
}
