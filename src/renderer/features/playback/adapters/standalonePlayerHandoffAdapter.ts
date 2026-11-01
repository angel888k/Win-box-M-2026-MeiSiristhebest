import { client } from '../../../api/client';
import type { StandalonePlayerRequestInput } from '../application/standalonePlayerRequest';
import { buildStandalonePlayerRequest } from '../application/standalonePlayerRequest';

/** Open a direct live/storage URL in the standalone player without turning it into a VOD request. */
export const standalonePlayerHandoffAdapter = {
  open(input: StandalonePlayerRequestInput): Promise<void> {
    return client.playerOpen(buildStandalonePlayerRequest(input));
  },
};
