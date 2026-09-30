import {
  getD1,
  getJapanTransitEnabled,
  getOwnerPocCatalogIntakeRuntime,
  getRouteSidecarServiceBinding,
} from '../../../db/index.ts';
import { createD1OwnerPocCatalogRead } from '../../../adapters/agent/d1-owner-poc-catalog.ts';
import { createRecommendConversationService } from '../../../product/application/decision/recommend-conversation-service.ts';
import { createD1MeteredRouteSidecarClient } from '../../../route-sidecar/d1-metered-route-sidecar-client.ts';
import { createOperationalNearbyDiagnosticRecorder } from '../../../route-sidecar/nearby-diagnostic-recorder.ts';
import { createRouteSidecarNearbyAdapter } from '../../../route-sidecar/route-sidecar-nearby-adapter.ts';
import {
  createAgentSettingsService,
  createD1AgentSettingsStore,
} from '../agent-settings.ts';
import { createRecommendInterpreter } from './recommend-interpreter.ts';

export function getServerRecommendService() {
  const database = getD1();
  const japanTransitEnabled = getJapanTransitEnabled();
  const runtime = getOwnerPocCatalogIntakeRuntime();
  const routes = createRouteSidecarNearbyAdapter(
    createD1MeteredRouteSidecarClient({
      database,
      service: getRouteSidecarServiceBinding(),
      clock: () => new Date(),
      diagnosticRecorder: createOperationalNearbyDiagnosticRecorder(),
      japanTransitEnabled,
    }),
    { japanTransitEnabled },
  );
  const settings = createAgentSettingsService(
    createD1AgentSettingsStore(database),
    runtime.agentSettingsSecret,
    runtime,
  );
  return createRecommendConversationService({
    catalog: createD1OwnerPocCatalogRead(database),
    interpreter: {
      async interpret(input, options) {
        const config = await settings.resolve();
        if (!config.agentApiKey || !config.agentBaseUrl || !config.agentModel)
          throw new Error('Recommend model is not configured');
        return createRecommendInterpreter({
          agentApiKey: config.agentApiKey,
          agentBaseUrl: config.agentBaseUrl,
          agentModel: config.agentModel,
        }).interpret(input, options);
      },
    },
    locationResolver: routes.locationResolver,
    routeProvider: routes.routeProvider,
    transitRouteProvider: routes.transitRouteProvider,
    clock: { now: () => new Date() },
  });
}
