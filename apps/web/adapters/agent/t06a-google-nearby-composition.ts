import { resolve4, resolve6 } from 'node:dns/promises';

import googlePolicyEvidence from '../../../../features/004-openclaw-atlas-poc/evidence/provider-policies/google-2026-09-13.v1.json' with { type: 'json' };
import { createGoogleLocationResolver } from '../../adapters/providers/google-location-resolver.ts';
import {
  createGoogleFixedEndpointTransport,
  type GoogleFixedEndpointTransport,
} from '../../adapters/providers/google-fixed-endpoint-transport.ts';
import { createGoogleTransitRouteProvider } from '../../adapters/providers/google-transit-route-provider.ts';
import { createGoogleWalkingRouteMatrixProvider } from '../../adapters/providers/google-walking-route-matrix-provider.ts';
import { publicUnicastAddressClassifier } from '../../adapters/providers/public-unicast-address-classifier.ts';
import { createT06aNearbyRecommendation } from '../../product/application/decision/t06a-nearby-recommendation.ts';
import type { AgentNearbyOperationDependencies } from '../../product/application/decision/agent-nearby-operation.ts';
import {
  createProviderPolicyGateway,
  type ProviderPolicy,
  type ProviderTransportRequest,
  type ProviderTransportResponse,
  type ProviderUsagePort,
} from '../../product/provider-policy/provider-policy-gateway.ts';
import { createD1PocCatalogRead } from './d1-poc-catalog-read.ts';
import { D1ProviderUsage } from './d1-provider-usage.ts';

const googlePolicy = googlePolicyEvidence as unknown as ProviderPolicy;
const matrixFieldMask =
  'originIndex,destinationIndex,status,condition,distanceMeters,duration';

export interface T06aGoogleNearbyCompositionOptions {
  readonly database: D1Database;
  readonly googleMapsApiKey: string | undefined;
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
  readonly clock?: { readonly now: () => Date };
  readonly resolve?: (hostname: string) => Promise<readonly string[]>;
  readonly usage?: ProviderUsagePort;
}

export function createT06aGoogleNearbyComposition({
  database,
  googleMapsApiKey,
  fetch = (url, init) => globalThis.fetch(url, init),
  clock = { now: () => new Date() },
  resolve = resolveGooglePublicAddresses,
  usage,
}: T06aGoogleNearbyCompositionOptions): {
  readonly catalogRead: ReturnType<typeof createD1PocCatalogRead>;
  readonly agentNearby: Omit<AgentNearbyOperationDependencies, 'catalog'>;
} {
  const fixedTransport = createGoogleFixedEndpointTransport({
    apiKey: googleMapsApiKey,
    fetch,
  });
  const providerUsage =
    usage ?? new D1ProviderUsage(database, () => clock.now());
  const gateway = isConfiguredSecret(googleMapsApiKey)
    ? createProviderPolicyGateway({
        policies: [googlePolicy],
        resolve,
        addressClassifier: publicUnicastAddressClassifier,
        usage: providerUsage,
        transport: (request) => bridgeGoogleRequest(request, fixedTransport),
      })
    : disabledGateway;
  const catalogRead = createD1PocCatalogRead(database);
  const base = {
    clock,
    routeEvidenceMaximumAgeMs: 5 * 60 * 1000,
    locationResolver: createGoogleLocationResolver({
      gateway,
      estimatedCostUsd: 0.005,
      clock: () => clock.now(),
    }),
    routeProvider: createGoogleWalkingRouteMatrixProvider({
      gateway,
      maximumDestinationsPerBatch: 25,
      estimatedCostUsdPerElement: 0.005,
      clock: () => clock.now(),
    }),
    transitRouteProvider: createGoogleTransitRouteProvider({
      gateway,
      estimatedCostUsd: 0.01,
      clock: () => clock.now(),
    }),
    entryAccessProvider: {
      async inspectWalkIn() {
        return {
          status: 'unknown' as const,
          warning: 'Walk-in status is unavailable.',
        };
      },
      async inspectQueue() {
        return {
          status: 'unknown' as const,
          warning: 'Queue status is unavailable.',
        };
      },
    },
    entryAccessPolicy: {
      policyVersion: googlePolicy.policyVersion,
      allowedSourceOrigins: [],
      maximumAgeMs: 5 * 60 * 1000,
      clock,
    },
    personalFacts: {
      async read(itemId: string) {
        const item = await catalogRead.get(itemId);
        return {
          manualVisited:
            item !== undefined &&
            'hasVisited' in item &&
            item.hasVisited === true,
          visitCount:
            item !== undefined && 'hasVisited' in item && item.hasVisited
              ? 1
              : 0,
        };
      },
    },
    mapDeepLink: (item: {
      readonly officialUrl?: string;
      readonly address: string;
    }) =>
      item.officialUrl ??
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.address)}`,
  };
  return {
    catalogRead,
    agentNearby: {
      ...base,
      nearbyRecommendation: createT06aNearbyRecommendation({
        ...base,
        catalog: catalogRead,
        shortlistLimit: 25,
        transitShortlistLimit: 5,
      }),
    },
  };
}

const disabledGateway = {
  async invoke() {
    return {
      ok: false as const,
      error: {
        kind: 'policy_denied' as const,
        message: 'Google Maps is unavailable.',
      },
    };
  },
};

function isConfiguredSecret(value: string | undefined): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 512 &&
    !value.startsWith('<')
  );
}

async function bridgeGoogleRequest(
  request: ProviderTransportRequest,
  fixedTransport: GoogleFixedEndpointTransport,
): Promise<ProviderTransportResponse> {
  const url = safelyParseUrl(request.url);
  if (!url || request.providerId !== googlePolicy.providerId) return invalid();
  if (
    request.method === 'GET' &&
    isExactUrl(url, 'maps.googleapis.com', '/maps/api/geocode/json') &&
    hasExactQuery(url, {
      address: undefined,
      region: 'jp',
      components: 'country:JP',
    }) &&
    typeof url.searchParams.get('address') === 'string'
  ) {
    return fixedTransport.execute({
      kind: 'geocoding',
      query: {
        address: url.searchParams.get('address')!,
        region: 'jp',
        components: 'country:JP',
      },
      fields: request.fields.filter(isGeocodeField),
    });
  }
  if (
    request.method === 'POST' &&
    request.body &&
    isExactUrl(
      url,
      'routes.googleapis.com',
      '/distanceMatrix/v2:computeRouteMatrix',
    ) &&
    hasExactQuery(url, { fields: matrixFieldMask })
  ) {
    return fixedTransport.execute({
      kind: 'route_matrix',
      body: request.body,
      fields: request.fields.filter(isRouteField),
    });
  }
  if (
    request.method === 'POST' &&
    request.body &&
    isExactUrl(url, 'routes.googleapis.com', '/directions/v2:computeRoutes') &&
    [...url.searchParams.keys()].length === 0
  ) {
    return fixedTransport.execute({
      kind: 'routes',
      body: request.body,
      fields: request.fields.filter(isDirectionsField),
    });
  }
  return invalid();
}

function safelyParseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function isExactUrl(url: URL, hostname: string, pathname: string): boolean {
  return (
    url.protocol === 'https:' &&
    url.hostname === hostname &&
    url.port === '' &&
    url.pathname === pathname &&
    url.username === '' &&
    url.password === ''
  );
}

function hasExactQuery(
  url: URL,
  expected: Record<string, string | undefined>,
): boolean {
  const entries = [...url.searchParams.entries()];
  return (
    entries.length === Object.keys(expected).length &&
    Object.entries(expected).every(([name, value]) => {
      const values = url.searchParams.getAll(name);
      return (
        values.length === 1 && (value === undefined || values[0] === value)
      );
    })
  );
}

function isGeocodeField(
  value: string,
): value is 'formattedAddress' | 'coordinates' {
  return value === 'formattedAddress' || value === 'coordinates';
}
function isRouteField(
  value: string,
): value is 'routeDurationSeconds' | 'routeDistanceMeters' {
  return value === 'routeDurationSeconds' || value === 'routeDistanceMeters';
}
function isDirectionsField(
  value: string,
): value is 'routeDurationSeconds' | 'routeDistanceMeters' | 'transitLegs' {
  return isRouteField(value) || value === 'transitLegs';
}
function invalid(): ProviderTransportResponse {
  return { status: 400, headers: {}, body: {} };
}

async function resolveGooglePublicAddresses(
  hostname: string,
): Promise<readonly string[]> {
  if (
    hostname !== 'maps.googleapis.com' &&
    hostname !== 'routes.googleapis.com'
  )
    return [];
  const results = await Promise.allSettled([
    resolve4(hostname),
    resolve6(hostname),
  ]);
  return results.flatMap((result) =>
    result.status === 'fulfilled' ? result.value : [],
  );
}
