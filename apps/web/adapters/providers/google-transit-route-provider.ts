import type {
  GeoPoint,
  TransitRouteEvidence,
  TransitRouteProvider,
} from '../../product/application/decision/nearby-recommendation.ts';
import type { ProviderPolicyGateway } from '../../product/provider-policy/provider-policy-gateway.ts';
import { GOOGLE_ROUTES_CREDENTIAL_SCOPE } from './google-provider-contract.ts';

export interface GoogleTransitRouteProviderOptions {
  readonly gateway: Pick<ProviderPolicyGateway, 'invoke'>;
  readonly estimatedCostUsd: number;
  readonly clock: () => Date;
}

export function createGoogleTransitRouteProvider({
  gateway,
  estimatedCostUsd,
  clock,
}: GoogleTransitRouteProviderOptions): TransitRouteProvider {
  return {
    async transit(origin, destination) {
      try {
        const result = await gateway.invoke({
          providerId: 'google-maps-platform',
          credentialScope: GOOGLE_ROUTES_CREDENTIAL_SCOPE,
          method: 'POST',
          url: 'https://routes.googleapis.com/directions/v2:computeRoutes',
          body: routeBody(origin, destination),
          fields: [{ name: 'transitLegs', use: 'chat' }],
          cache: { mode: 'request_only' },
          estimatedCostUsd,
        });
        if (!result.ok) return unavailable();

        const transitLegs = asRecord(result.value.fields.transitLegs);
        const attribution = result.value.attribution;
        if (
          !transitLegs ||
          !isNonNegativeNumber(transitLegs.durationSeconds) ||
          !isNonNegativeInteger(transitLegs.boardingCount) ||
          !isLineIdentities(transitLegs.lineIdentities) ||
          transitLegs.lineIdentities.length !== transitLegs.boardingCount ||
          !isNonNegativeInteger(transitLegs.transferCount) ||
          transitLegs.transferCount !==
            Math.max(0, transitLegs.boardingCount - 1) ||
          !attribution ||
          attribution.label !== 'Google Maps'
        ) {
          return unavailable();
        }

        return {
          status: 'fresh',
          durationSeconds: transitLegs.durationSeconds,
          boardingCount: transitLegs.boardingCount,
          lineIdentities: transitLegs.lineIdentities,
          transferCount: transitLegs.transferCount,
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
    travelMode: 'TRANSIT',
    languageCode: 'ja',
    units: 'METRIC',
  } as const;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isLineIdentities(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (identity) => typeof identity === 'string' && identity.trim().length > 0,
    )
  );
}

function unavailable(): TransitRouteEvidence {
  return {
    status: 'unavailable',
    warning: 'Transit route is temporarily unavailable.',
  };
}
