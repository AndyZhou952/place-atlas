// Wires the Recommend harness to this deployment's bindings, unchanged from the original
// server Recommend service: the model only interprets the request; candidates, distances and
// route times come from the saved catalog and the optional route sidecar.
import { createOperationalNearbyDiagnosticRecorder } from '../../../../route-sidecar/nearby-diagnostic-recorder.ts';
import type { Env } from '../../env.ts';
import { listCatalogItems } from '../../db.ts';
import { completeSettings, resolveAgentSettings } from '../../settings.ts';
import { D1ProviderUsage } from '../discovery/quota.ts';
import { createRecommendConversationService } from './conversation-service.ts';
import { createRecommendInterpreter } from './interpreter.ts';
import { createRouteSidecarNearbyAdapter } from './route-sidecar-adapter.ts';
import { createMeteredRouteSidecarClient } from './route-sidecar-client.ts';

export function createRecommendHarness(env: Env, fetcher: typeof fetch = fetch) {
  const routes = createRouteSidecarNearbyAdapter(
    createMeteredRouteSidecarClient({
      service: env.ROUTE_SIDECAR,
      usage: new D1ProviderUsage(env.DB, () => new Date()),
      diagnosticRecorder: createOperationalNearbyDiagnosticRecorder(),
    }),
  );
  return createRecommendConversationService({
    catalog: { list: () => listCatalogItems(env.DB) },
    interpreter: {
      async interpret(input, options) {
        const settings = completeSettings(await resolveAgentSettings(env));
        if (!settings) throw new Error('Recommend model is not configured');
        return createRecommendInterpreter(settings, fetcher).interpret(input, options);
      },
    },
    locationResolver: routes.locationResolver,
    routeProvider: routes.routeProvider,
    transitRouteProvider: routes.transitRouteProvider,
    clock: { now: () => new Date() },
  });
}
