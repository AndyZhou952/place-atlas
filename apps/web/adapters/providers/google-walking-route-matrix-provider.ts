import type {
  GeoPoint,
  RouteProvider,
  WalkingRouteEvidence,
} from '../../product/application/decision/nearby-recommendation.ts';
import type { ProviderPolicyGateway } from '../../product/provider-policy/provider-policy-gateway.ts';
import { GOOGLE_ROUTES_CREDENTIAL_SCOPE } from './google-provider-contract.ts';

const fieldMask = [
  'originIndex',
  'destinationIndex',
  'status',
  'condition',
  'distanceMeters',
  'duration',
].join(',');

interface PendingRoute {
  readonly origin: GeoPoint;
  readonly destination: GeoPoint;
  readonly resolve: (route: WalkingRouteEvidence) => void;
}

export interface GoogleWalkingRouteMatrixProviderOptions {
  readonly gateway: Pick<ProviderPolicyGateway, 'invoke'>;
  readonly maximumDestinationsPerBatch: number;
  readonly estimatedCostUsdPerElement: number;
  readonly clock: () => Date;
}

export function createGoogleWalkingRouteMatrixProvider({
  gateway,
  maximumDestinationsPerBatch,
  estimatedCostUsdPerElement,
  clock,
}: GoogleWalkingRouteMatrixProviderOptions): RouteProvider {
  let pending: PendingRoute[] = [];
  let flushScheduled = false;

  const flush = async () => {
    const current = pending;
    pending = [];
    flushScheduled = false;
    const groups = Map.groupBy(current, ({ origin }) => pointKey(origin));
    await Promise.all(
      [...groups.values()].map((routes) =>
        requestBatch(
          routes,
          gateway,
          maximumDestinationsPerBatch,
          estimatedCostUsdPerElement,
          clock,
        ),
      ),
    );
  };

  return {
    walking(origin, destination) {
      if (!isPoint(origin) || !isPoint(destination)) {
        return Promise.resolve(unavailable());
      }
      return new Promise((resolve) => {
        pending.push({ origin, destination, resolve });
        if (!flushScheduled) {
          flushScheduled = true;
          queueMicrotask(() => void flush());
        }
      });
    },
  };
}

async function requestBatch(
  routes: readonly PendingRoute[],
  gateway: Pick<ProviderPolicyGateway, 'invoke'>,
  maximumDestinationsPerBatch: number,
  estimatedCostUsdPerElement: number,
  clock: () => Date,
): Promise<void> {
  if (
    routes.length === 0 ||
    !Number.isInteger(maximumDestinationsPerBatch) ||
    maximumDestinationsPerBatch < 1 ||
    maximumDestinationsPerBatch > 625 ||
    routes.length > maximumDestinationsPerBatch ||
    !isNonNegativeFiniteNumber(estimatedCostUsdPerElement)
  ) {
    resolveAllUnavailable(routes);
    return;
  }

  try {
    const result = await gateway.invoke({
      providerId: 'google-maps-platform',
      credentialScope: GOOGLE_ROUTES_CREDENTIAL_SCOPE,
      method: 'POST',
      url: `https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix?fields=${encodeURIComponent(fieldMask)}`,
      body: {
        origins: [matrixWaypoint(routes[0].origin)],
        destinations: routes.map(({ destination }) =>
          matrixWaypoint(destination),
        ),
        travelMode: 'WALK',
        languageCode: 'ja',
        regionCode: 'JP',
        units: 'METRIC',
      },
      fields: [
        { name: 'routeDurationSeconds', use: 'chat' },
        { name: 'routeDistanceMeters', use: 'chat' },
      ],
      cache: { mode: 'request_only' },
      estimatedCostUsd: Number(
        (estimatedCostUsdPerElement * routes.length).toFixed(12),
      ),
    });
    if (!result.ok) {
      resolveAllUnavailable(routes);
      return;
    }

    const durations = result.value.fields.routeDurationSeconds;
    const distances = result.value.fields.routeDistanceMeters;
    const attribution = result.value.attribution;
    if (
      !isRouteValues(durations, routes.length) ||
      !isRouteValues(distances, routes.length) ||
      !attribution ||
      attribution.label !== 'Google Maps'
    ) {
      resolveAllUnavailable(routes);
      return;
    }
    const checkedAt = clock().toISOString();
    routes.forEach((route, index) => {
      const durationSeconds = durations[index];
      const distanceMeters = distances[index];
      route.resolve(
        durationSeconds === null || distanceMeters === null
          ? unavailable()
          : {
              status: 'fresh',
              durationSeconds,
              distanceMeters,
              checkedAt,
              attribution,
            },
      );
    });
  } catch {
    resolveAllUnavailable(routes);
  }
}

function matrixWaypoint(point: GeoPoint) {
  return {
    waypoint: {
      location: {
        latLng: {
          latitude: point.latitude,
          longitude: point.longitude,
        },
      },
    },
  } as const;
}

function pointKey(point: GeoPoint): string {
  return `${point.latitude},${point.longitude}`;
}

function isPoint(point: GeoPoint): boolean {
  return (
    Number.isFinite(point.latitude) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    Number.isFinite(point.longitude) &&
    point.longitude >= -180 &&
    point.longitude <= 180
  );
}

function isRouteValues(
  value: unknown,
  length: number,
): value is (number | null)[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every(
      (candidate) => candidate === null || isNonNegativeFiniteNumber(candidate),
    )
  );
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function resolveAllUnavailable(routes: readonly PendingRoute[]): void {
  routes.forEach(({ resolve }) => resolve(unavailable()));
}

function unavailable(): WalkingRouteEvidence {
  return {
    status: 'unavailable',
    warning: 'Live walking route is temporarily unavailable.',
  };
}
