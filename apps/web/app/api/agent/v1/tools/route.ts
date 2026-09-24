import { env } from 'cloudflare:workers';

import {
  createIsolatedReadonlyAgentHttpHandler,
  createOwnerPocAgentHttpHandler,
  type IsolatedReadonlyAgentBindings,
  type OwnerPocAgentBindings,
} from '@/adapters/agent/isolated-readonly-agent-service';
import { createT06aGoogleNearbyComposition } from '@/adapters/agent/t06a-google-nearby-composition';
import { createOwnerPocComposition } from '@/lib/server/application/owner-poc-composition';
import { D1CatalogIntakeState } from '@/lib/server/application/d1-catalog-intake-state';
import { createServerAtlasApplication } from '@/lib/server/application/server-atlas-application';
import { getOwnerPocCatalogIntakeRuntime } from '@/db';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const deployment = env as unknown as { ATLAS_DEPLOYMENT_ENV?: string };
  if (deployment.ATLAS_DEPLOYMENT_ENV === 'owner-poc') {
    const bindings = env as unknown as OwnerPocAgentBindings;
    const composition = createOwnerPocComposition(
      bindings.DB,
      bindings.ROUTE_SIDECAR,
      getOwnerPocCatalogIntakeRuntime(),
    );
    const application = createServerAtlasApplication(
      bindings.DB,
      bindings.MEDIA,
      composition,
    );
    const handle = createOwnerPocAgentHttpHandler(
      bindings,
      application,
      new D1CatalogIntakeState(bindings.DB),
    );
    return handle(request);
  }

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
