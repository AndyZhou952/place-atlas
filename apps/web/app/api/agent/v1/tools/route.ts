import { env } from 'cloudflare:workers';

import {
  createIsolatedReadonlyAgentHttpHandler,
  type IsolatedReadonlyAgentBindings,
} from '@/adapters/agent/isolated-readonly-agent-service';
import { createT06aGoogleNearbyComposition } from '@/adapters/agent/t06a-google-nearby-composition';
import { createServerAtlasApplication } from '@/lib/server/application/server-atlas-application';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const bindings = env as unknown as IsolatedReadonlyAgentBindings;
  const composition = createT06aGoogleNearbyComposition({
    database: bindings.DB,
    googleMapsApiKey: bindings.GOOGLE_MAPS_API_KEY,
  });
  const application = createServerAtlasApplication(
    bindings.DB,
    bindings.MEDIA,
    {
      catalogRead: composition.catalogRead,
      agentNearby: composition.agentNearby,
    },
  );
  const handle = createIsolatedReadonlyAgentHttpHandler(bindings, application);
  return handle(request);
}
