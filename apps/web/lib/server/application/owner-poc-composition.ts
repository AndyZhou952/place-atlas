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
import { createNominatimDurableGeocoderAdapter } from '../../../adapters/providers/nominatim-durable-geocoder.ts';
import { createNominatimFixedEndpointTransport } from '../../../adapters/providers/nominatim-fixed-endpoint-transport.ts';
import { createHttpResearchRelayRpc } from '../../../adapters/research-relay/http-research-relay-rpc.ts';
import { createResearchRelayWebResearchPort } from '../../../adapters/research-relay/research-relay-web-research-port.ts';
import { createCatalogIntakeModule } from '../../../product/application/catalog-intake/catalog-intake-coordinator.ts';
import { D1AtlasCatalogIntakePublisher } from './d1-atlas-catalog-intake.ts';
import { D1CatalogIntakeState } from './d1-catalog-intake-state.ts';
import { D1NominatimPolicyState } from './d1-nominatim-policy-state.ts';
import {
  inspectCatalogIntakeProviderModes,
  type CatalogIntakeProviderModes,
} from './catalog-intake-provider-mode-manifest.ts';

export interface OwnerPocCatalogIntakeOptions {
  readonly googlePlacesApiKey?: string;
  readonly providerModes?: CatalogIntakeProviderModes;
  readonly fetch?: typeof fetch;
  readonly clock?: { now(): Date };
  readonly idSource?: { nextId(): string };
  readonly researchRequestIds?: { nextId(): string };
  readonly researchRelayEndpoint?: string;
  readonly researchRelayIngressBearerSecret?: string;
  readonly researchAllowanceKeyVersion?: string;
  readonly researchAllowanceHmacSecret?: string;
  readonly researchResultKeyVersion?: string;
  readonly researchResultHmacSecret?: string;
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
  const discovery = createGooglePlaceDiscoveryAdapter(
    createGooglePlacesNewClient({
      ...(providerModes.googlePlaces === 'enabled'
        ? { apiKey: intakeOptions.googlePlacesApiKey }
        : {}),
      usage,
      ...(intakeOptions.fetch ? { fetch: intakeOptions.fetch } : {}),
    }),
  );
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
  const webResearchPort = createOwnerPocWebResearchPort({
    options: intakeOptions,
    state,
    clock,
  });
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
      researchRelay: webResearchPort
        ? ('relay_enabled_guarded_v1' as const)
        : ('relay_disabled_manual_unknown' as const),
    },
  };
}

function createOwnerPocWebResearchPort(input: {
  readonly options: OwnerPocCatalogIntakeOptions;
  readonly state: D1CatalogIntakeState;
  readonly clock: { now(): Date };
}) {
  const { options } = input;
  if (options.providerModes?.researchRelay !== 'relay_enabled_guarded_v1') {
    return undefined;
  }
  if (
    !validIdentifier(options.researchAllowanceKeyVersion) ||
    !validIdentifier(options.researchResultKeyVersion) ||
    !validSecret(options.researchAllowanceHmacSecret) ||
    !validSecret(options.researchResultHmacSecret) ||
    !validSecret(options.researchRelayIngressBearerSecret) ||
    typeof options.researchRelayEndpoint !== 'string'
  ) {
    throw new TypeError('Guarded Research Relay configuration is invalid.');
  }
  return createResearchRelayWebResearchPort({
    statePort: input.state,
    allowanceKey: {
      keyVersion: options.researchAllowanceKeyVersion,
      secret: options.researchAllowanceHmacSecret,
    },
    resultKeys: {
      [options.researchResultKeyVersion]: options.researchResultHmacSecret,
    },
    clock: input.clock,
    requestIds: options.researchRequestIds ?? {
      nextId: () => crypto.randomUUID(),
    },
    relay: createHttpResearchRelayRpc({
      endpoint: options.researchRelayEndpoint,
      bearerSecret: options.researchRelayIngressBearerSecret,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    }),
  });
}

function validIdentifier(value: string | undefined): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._-]{1,64}$/u.test(value);
}

function validSecret(value: string | undefined): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 32 &&
    value.length <= 4_096 &&
    !hasAsciiControlCharacter(value)
  );
}

function hasAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
