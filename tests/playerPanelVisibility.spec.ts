import { describe, expect, it } from 'vitest';
import {
  transitionPlayerPanelVisibility,
  type PlayerPanelVisibility,
} from '../src/renderer/features/playback/application/playerPanelVisibility';

const empty: PlayerPanelVisibility = {
  subtitle: false,
  danmaku: false,
  fit: false,
  audio: false,
  superResolution: false,
  skip: false,
  episodes: false,
  stats: false,
  keys: false,
  capabilities: false,
};

describe('player panel visibility policy', () => {
  it('opens only the requested panel and closes an already open panel on toggle', () => {
    const subtitle = transitionPlayerPanelVisibility(empty, { type: 'open', panel: 'subtitle' });

    expect(subtitle).toEqual({ ...empty, subtitle: true });
    expect(transitionPlayerPanelVisibility(subtitle, { type: 'toggle', panel: 'subtitle' })).toEqual(empty);
  });

  it('switches exclusive panels and closes them before volume interactions', () => {
    const prior = { ...empty, subtitle: true, skip: true, episodes: true };

    expect(transitionPlayerPanelVisibility(prior, { type: 'toggle', panel: 'stats' })).toEqual({ ...empty, stats: true });
    expect(transitionPlayerPanelVisibility(prior, { type: 'close-all' })).toEqual(empty);
  });

  it('opens the capability panel exclusively with other technical panels', () => {
    expect(transitionPlayerPanelVisibility({ ...empty, stats: true }, { type: 'open', panel: 'capabilities' }))
      .toEqual({ ...empty, capabilities: true });
  });
});
