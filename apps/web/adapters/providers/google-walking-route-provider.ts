import type {
  GeoPoint,
  RouteProvider,
  WalkingRouteEvidence,
} from '../../product/application/decision/nearby-recommendation.ts';
import type { ProviderPolicyGateway } from '../../product/provider-policy/provider-policy-gateway.ts';
import { GOOGLE_ROUTES_CREDENTIAL_SCOPE } from './google-provider-contract.ts';

export interface GoogleWalkingRouteProviderOptions {
  readonly gateway: Pick<ProviderPolicyGateway, 'invoke'>;
  readonly estimatedCostUsd: number;
  readonly clock: () => Date;
}

export function createGoogleWalkingRouteProvider({
  gateway,
  estimatedCostUsd,
  clock,
}: GoogleWalkingRouteProviderOptions): RouteProvider {
  return {
    async walking(origin, destination) {
      try {
        const result = await gateway.invoke({
          providerId: 'google-maps-platform',
          credentialScope: GOOGLE_ROUTES_CREDENTIAL_SCOPE,
          method: 'POST',
          url: 'https://routes.googleapis.com/directions/v2:computeRoutes',
          body: routeBody(origin, destination),
          fields: [
            { name: 'routeDurationSeconds', use: 'chat' },
            { name: 'routeDistanceMeters', use: 'chat' },
          ],
          cache: { mode: 'request_only' },
          estimatedCostUsd,
        });
        if (!result.ok) return unavailable();

        const durationSeconds = result.value.fields.routeDurationSeconds;
        const distanceMeters = result.value.fields.routeDistanceMeters;
        const attribution = result.value.attribution;
        if (
          !isNonNegativeFiniteNumber(durationSeconds) ||
          !isNonNegativeFiniteNumber(distanceMeters) ||
          !attribution ||
          attribution.label !== 'Google Maps'
        ) {
          return unavailable();
        }

        return {
          status: 'fresh',
          durationSeconds,
          distanceMeters,
          checkedAt: clock().toISOString(),
          attribution,
        };
      } catch {
        return unavailable();
      }
    },
  };
}

function routeBody(origin: GeoPoint, destination: GeoPoint) {
  return {
    origin: {
      location: {
        latLng: {
          latitude: origin.latitude,
          longitude: origin.longitude,
        },
      },
    },
    destination: {
      location: {
        latLng: {
          latitude: destination.latitude,
          longitude: destination.longitude,
        },
      },
    },
    travelMode: 'WALK',
    languageCode: 'ja',
    units: 'METRIC',
  } as const;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function unavailable(): WalkingRouteEvidence {
  return {
    status: 'unavailable',
    warning: 'Live walking route is temporarily unavailable.',
  };
}
