import type { LocationResolver } from '../../product/application/decision/nearby-recommendation.ts';
import type { ProviderPolicyGateway } from '../../product/provider-policy/provider-policy-gateway.ts';

export interface GoogleLocationResolverOptions {
  readonly gateway: Pick<ProviderPolicyGateway, 'invoke'>;
  readonly estimatedCostUsd: number;
  readonly clock: () => Date;
}

export function createGoogleLocationResolver({
  gateway,
  estimatedCostUsd,
  clock,
}: GoogleLocationResolverOptions): LocationResolver {
  return {
    async resolve(locationHint) {
      const hint = locationHint.trim();
      try {
        const result = await gateway.invoke({
          providerId: 'google-maps-platform',
          credentialScope: 'geocoding.read',
          method: 'GET',
          url: `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(hint)}&region=jp&components=country%3AJP`,
          fields: [
            { name: 'formattedAddress', use: 'chat' },
            { name: 'coordinates', use: 'request' },
          ],
          cache: { mode: 'request_only' },
          estimatedCostUsd,
        });

        if (!result.ok) return dependencyFailure();
        const addresses = result.value.fields.formattedAddress;
        const provenance = {
          providerId: result.value.providerId,
          policyVersion: result.value.policyVersion,
          sourceUrl: result.value.sourceUrl,
          checkedAt: clock().toISOString(),
        };
        const coordinates = result.value.fields.coordinates;
        const attribution = result.value.attribution;
        if (
          !Array.isArray(addresses) ||
          !Array.isArray(coordinates) ||
          !attribution ||
          attribution.label !== 'Google Maps'
        ) {
          return dependencyFailure();
        }

        const candidates = addresses.flatMap((address, index) => {
          const point = coordinates[index];
          return typeof address === 'string' &&
            address.trim().length > 0 &&
            isPoint(point)
            ? [{ canonicalAddress: address, point }]
            : [];
        });
        if (candidates.length === 0) {
          return addresses.length === 0 && coordinates.length === 0
            ? {
                status: 'unresolved',
                reason: 'not_found',
                warning: 'No matching address was found.',
                provenance,
              }
            : dependencyFailure();
        }
        if (candidates.length === 1) {
          return {
            status: 'resolved',
            location: candidates[0],
            attribution,
            provenance,
          };
        }
        return {
          status: 'ambiguous',
          candidates: candidates.slice(0, 3),
          provenance,
          attribution,
        };
      } catch {
        return dependencyFailure();
      }
    },
  };
}

function isPoint(value: unknown): value is {
  readonly latitude: number;
  readonly longitude: number;
} {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const point = value as Record<string, unknown>;
  return (
    typeof point.latitude === 'number' &&
    Number.isFinite(point.latitude) &&
    point.latitude >= -90 &&
    point.latitude <= 90 &&
    typeof point.longitude === 'number' &&
    Number.isFinite(point.longitude) &&
    point.longitude >= -180 &&
    point.longitude <= 180
  );
}

function dependencyFailure() {
  return {
    status: 'unresolved',
    reason: 'dependency_failure',
    warning: 'Address lookup is temporarily unavailable.',
  } as const;
}
