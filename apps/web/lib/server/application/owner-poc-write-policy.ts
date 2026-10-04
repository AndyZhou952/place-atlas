import { env } from 'cloudflare:workers';

import { ownerPocWriteUnavailableResponse } from '@/app/api/owner-mutation-response';

export function rejectUncoordinatedOwnerPocWrite(): Response | undefined {
  const bindings = env as unknown as {
    readonly ATLAS_DEPLOYMENT_ENV?: string;
  };
  return bindings.ATLAS_DEPLOYMENT_ENV === 'owner-poc'
    ? ownerPocWriteUnavailableResponse()
    : undefined;
}
