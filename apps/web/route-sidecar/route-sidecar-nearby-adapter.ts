import type {
  LocationResolver,
  RouteProvider,
} from '../product/application/decision/nearby-recommendation.ts';
import type { GoogleRouteSidecarPort } from './route-sidecar-contract.ts';

const policyVersion = 'google-route-sidecar-v1';

export function createRouteSidecarNearbyAdapter(
  sidecar: GoogleRouteSidecarPort,
): {
  readonly locationResolver: LocationResolver;
  readonly routeProvider: RouteProvider;
} {
  return {
    locationResolver: {
      async resolve(locationHint) {
        let result;
        try {
          result = await sidecar.geocode({ locationHint });
        } catch {
          return unresolvedLocation();
        }
        if (!result.ok) return unresolvedLocation();
        const { evidence } = result;
        const candidates = evidence.candidates.map((candidate) => ({
          canonicalAddress: candidate.formattedAddress,
          point: {
            latitude: candidate.point.latitude,
            longitude: candidate.point.longitude,
          },
        }));
        const metadata = {
          attribution: evidence.attribution,
          provenance: {
            providerId: evidence.source.providerId,
            policyVersion,
            sourceUrl: evidence.source.endpoint,
            checkedAt: evidence.checkedAt,
          },
        };
        if (candidates.length === 0) {
          return {
            status: 'unresolved',
            reason: 'not_found',
            warning: 'The location could not be resolved.',
            provenance: metadata.provenance,
          };
        }
        if (candidates.length > 1) {
          return { status: 'ambiguous', candidates, ...metadata };
        }
        return {
          status: 'resolved',
          location: candidates[0],
          ...metadata,
        };
      },
    },
    routeProvider: {
      async walking(origin, destination) {
        let result;
        try {
          result = await sidecar.walkingMatrix({
            origin,
            destinations: [destination],
          });
        } catch {
          return unavailableWalkingRoute();
        }
        if (!result.ok) return unavailableWalkingRoute();
        const route = result.evidence.routes.find(
          ({ destinationIndex }) => destinationIndex === 0,
        );
        if (
          !route ||
          route.durationSeconds === null ||
          route.distanceMeters === null
        ) {
          return {
            status: 'unavailable',
            warning: 'Walking route is unavailable.',
          };
        }
        return {
          status: 'fresh',
          durationSeconds: route.durationSeconds,
          distanceMeters: route.distanceMeters,
          checkedAt: result.evidence.checkedAt,
          attribution: result.evidence.attribution,
        };
      },
    },
  };
}

function unresolvedLocation() {
  return {
    status: 'unresolved' as const,
    reason: 'dependency_failure' as const,
    warning: 'Address lookup is temporarily unavailable.',
  };
}

function unavailableWalkingRoute() {
  return {
    status: 'unavailable' as const,
    warning: 'Walking route is temporarily unavailable.',
  };
}
