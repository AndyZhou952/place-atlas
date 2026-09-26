import type { NearbyRecommendOperationDependencies } from '../../../product/application/decision/agent-nearby-operation.ts';
import { createCatalogItemProjection } from '../../../product/application/catalog/catalog-item-projection.ts';
import { createVisitTargetProjection } from '../../../product/application/visits/visit-item-projection.ts';
import {
  createD1OwnerPocCatalogRead,
  createD1OwnerPocPersonalFactsRead,
} from '../../../adapters/agent/d1-owner-poc-catalog.ts';
import { createD1MeteredRouteSidecarClient } from '../../../route-sidecar/d1-metered-route-sidecar-client.ts';
import type { RouteSidecarServiceBinding } from '../../../route-sidecar/metered-route-sidecar-client.ts';
import { createOperationalNearbyDiagnosticRecorder } from '../../../route-sidecar/nearby-diagnostic-recorder.ts';
import { createRouteSidecarNearbyAdapter } from '../../../route-sidecar/route-sidecar-nearby-adapter.ts';
import { D1ProviderUsage } from '../../../adapters/agent/d1-provider-usage.ts';
import { createGooglePlaceDiscoveryAdapter } from '../../../adapters/providers/google-place-discovery.ts';
import { createGooglePlacesNewClient } from '../../../adapters/providers/google-places-new-client.ts';
import { createTabelogPlaceDiscoveryPort } from '../../../adapters/providers/tabelog-place-discovery.ts';
import { createNominatimDurableGeocoderAdapter } from '../../../adapters/providers/nominatim-durable-geocoder.ts';
import { createNominatimFixedEndpointTransport } from '../../../adapters/providers/nominatim-fixed-endpoint-transport.ts';
import { createConfiguredPlaceResearchAgent } from '../../../agent/place-research.ts';
import {
  createRestaurantSourceReader,
  type BrowserContentBinding,
} from '../../../agent/browser-source-reader.ts';
import {
  createAgentSettingsService,
  createD1AgentSettingsStore,
} from '../agent-settings.ts';
import { createCatalogIntakeModule } from '../../../product/application/catalog-intake/catalog-intake-coordinator.ts';
import { D1AtlasCatalogIntakePublisher } from './d1-atlas-catalog-intake.ts';
import { D1CatalogIntakeState } from './d1-catalog-intake-state.ts';
import { D1NominatimPolicyState } from './d1-nominatim-policy-state.ts';
import {
  inspectCatalogIntakeProviderModes,
  type CatalogIntakeProviderModes,
} from './catalog-intake-provider-mode-manifest.ts';

export interface OwnerPocCatalogIntakeOptions {
  readonly browser?: BrowserContentBinding;
  readonly agentSettingsSecret?: string;
  readonly agentApiKey?: string;
  readonly agentBaseUrl?: string;
  readonly agentModel?: string;
  readonly searchApiKey?: string;
  readonly googlePlacesApiKey?: string;
  readonly providerModes?: CatalogIntakeProviderModes;
  readonly fetch?: typeof fetch;
  readonly clock?: { now(): Date };
  readonly idSource?: { nextId(): string };
}

export const ownerPocNominatimIdentity = {
  endpoint: 'https://nominatim.openstreetmap.org/search',
  identifyingUserAgent:
    'JapanAtlasOwnerPoC/1.0 (+https://japan-atlas-owner-poc.japan-atlas-poc.workers.dev/terms)',
  referer: 'https://japan-atlas-owner-poc.japan-atlas-poc.workers.dev/',
} as const;

export function createOwnerPocComposition(
  database: D1Database,
  routeSidecarService?: RouteSidecarServiceBinding,
  intakeOptions: OwnerPocCatalogIntakeOptions = {},
) {
  const catalogRead = createD1OwnerPocCatalogRead(database);
  const clock = intakeOptions.clock ?? { now: () => new Date() };
  const sourceReader = intakeOptions.browser
    ? createRestaurantSourceReader(intakeOptions.browser, intakeOptions.fetch)
    : undefined;
  const routeEvidence = createRouteSidecarNearbyAdapter(
    createD1MeteredRouteSidecarClient({
      database,
      service: routeSidecarService,
      clock: () => clock.now(),
      diagnosticRecorder: createOperationalNearbyDiagnosticRecorder(),
    }),
  );
  const agentNearby: Omit<NearbyRecommendOperationDependencies, 'catalog'> = {
    clock,
    routeEvidenceMaximumAgeMs: 5 * 60 * 1000,
    locationResolver: routeEvidence.locationResolver,
    routeProvider: routeEvidence.routeProvider,
    entryAccessProvider: {
      async inspectWalkIn() {
        return {
          status: 'unknown',
          warning: 'Walk-in status is unavailable.',
        };
      },
      async inspectQueue() {
        return { status: 'unknown', warning: 'Queue status is unavailable.' };
      },
    },
    entryAccessPolicy: {
      policyVersion: 'owner-poc-sidecar-pending-v1',
      allowedSourceOrigins: [],
      maximumAgeMs: 5 * 60 * 1000,
      clock: { now: () => new Date() },
    },
    personalFacts: createD1OwnerPocPersonalFactsRead(database),
    mapDeepLink: (item) =>
      item.officialUrl ??
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address)}`,
  };
  const providerModes = inspectCatalogIntakeProviderModes(
    intakeOptions.providerModes ?? {},
  );
  const state = new D1CatalogIntakeState(database, clock);
  const usage = new D1ProviderUsage(database, () => clock.now());
  const googleDiscovery = createGooglePlaceDiscoveryAdapter(
    createGooglePlacesNewClient({
      ...(providerModes.googlePlaces === 'enabled'
        ? { apiKey: intakeOptions.googlePlacesApiKey }
        : {}),
      usage,
      ...(intakeOptions.fetch ? { fetch: intakeOptions.fetch } : {}),
    }),
  );
  const discovery =
    providerModes.googlePlaces === 'enabled' && intakeOptions.googlePlacesApiKey
      ? googleDiscovery
      : createTabelogPlaceDiscoveryPort({
          ...(sourceReader ? { sourceReader } : {}),
          ...(intakeOptions.fetch ? { fetch: intakeOptions.fetch } : {}),
          ...(intakeOptions.searchApiKey
            ? { searchApiKey: intakeOptions.searchApiKey }
            : {}),
        });
  const nominatimState = new D1NominatimPolicyState(database, clock);
  const durableGeocoder =
    providerModes.durableGeocoder === 'enabled'
      ? createNominatimDurableGeocoderAdapter({
          ...ownerPocNominatimIdentity,
          transport: createNominatimFixedEndpointTransport(
            intakeOptions.fetch ? { fetch: intakeOptions.fetch } : {},
          ),
          cache: nominatimState,
          rateGate: nominatimState,
          clock,
        })
      : undefined;
  const idSource = intakeOptions.idSource ?? {
    nextId: () => crypto.randomUUID(),
  };
  const researchOptions = {
    ...intakeOptions,
    ...(sourceReader ? { sourceReader } : {}),
  };
  const environmentResearchPort =
    createConfiguredPlaceResearchAgent(researchOptions);
  const webResearchPort = intakeOptions.agentSettingsSecret
    ? {
        async research(
          input: Parameters<
            NonNullable<typeof environmentResearchPort>['research']
          >[0],
        ) {
          try {
            const config = await createAgentSettingsService(
              createD1AgentSettingsStore(database),
              intakeOptions.agentSettingsSecret,
              intakeOptions,
            ).resolve();
            const agent = createConfiguredPlaceResearchAgent({
              ...researchOptions,
              ...config,
            });
            return agent
              ? agent.research(input)
              : { kind: 'unavailable' as const };
          } catch {
            return { kind: 'unavailable' as const };
          }
        },
      }
    : environmentResearchPort;
  const catalogIntakeModule = createCatalogIntakeModule({
    discoveryPort: discovery,
    ...(durableGeocoder ? { durableGeocoderPort: durableGeocoder } : {}),
    ...(webResearchPort ? { webResearchPort } : {}),
    enrichmentPolicy: webResearchPort ? 'enrich_if_available' : 'disabled',
    statePort: state,
    atlasCatalogIntakePort: new D1AtlasCatalogIntakePublisher(database, {
      now: () => clock.now(),
      nextId: () => idSource.nextId(),
    }),
    clock,
    idSource,
    catalogRevision: {
      async read() {
        const row = await database
          .prepare(
            'SELECT revision_number FROM atlas_catalog_revision WHERE singleton = 1',
          )
          .first<{ revision_number: number }>();
        return row ? `catalog-r${row.revision_number}` : 'catalog-missing';
      },
    },
  });

  return {
    catalogRead,
    catalogItemProjection: createCatalogItemProjection([]),
    visitItemProjection: createVisitTargetProjection([]),
    agentNearby,
    catalogIntakeModule,
    providerModes: {
      ...providerModes,
      agentResearch: webResearchPort
        ? ('configured' as const)
        : ('disabled' as const),
    },
  };
}
