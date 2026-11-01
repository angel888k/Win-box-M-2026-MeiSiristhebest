import type { SrMode } from '../../../../shared/player';
import { client } from '../../../api/client';
import type { SuperResolutionPort } from '../application/superResolutionPort';

export const superResolutionAdapter: SuperResolutionPort = {
  readCapability: () => client.pluginSr(),
  saveMode: async (mode: SrMode) => { await client.playerPrefsSet({ srMode: mode }); },
  applyMode: (mode: SrMode) => client.mpvCmd({ type: 'sr-mode', value: mode }),
  readRenderStatus: async (mode: SrMode) => {
    const result = await client.mpvCmd({ type: 'sr-render-status', value: mode });
    return result.renderStatus ?? { state: 'unavailable', detail: 'MPV 没有返回渲染状态。' };
  },
};
