import type {
  LocationResolver,
  RouteProvider,
  TransitRouteProvider,
} from '../product/application/decision/nearby-recommendation.ts';
import type { GoogleRouteSidecarPort } from './route-sidecar-contract.ts';
import { ROUTE_SIDECAR_MAXIMUM_MATRIX_DESTINATIONS } from './route-sidecar-contract.ts';
import { isJapanTransitArea } from './transit-coverage.ts';

const policyVersion = 'google-route-sidecar-v1';

export function createRouteSidecarNearbyAdapter(
  sidecar: GoogleRouteSidecarPort,
): {
  readonly locationResolver: LocationResolver;
  readonly routeProvider: RouteProvider;
  readonly transitRouteProvider: TransitRouteProvider;
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
        return (await this.walkingMany!(origin, [destination]))[0];
      },
      async walkingMany(origin, destinations) {
        const routes = [];
        for (
          let offset = 0;
          offset < destinations.length;
          offset += ROUTE_SIDECAR_MAXIMUM_MATRIX_DESTINATIONS
        ) {
          const batch = destinations.slice(
            offset,
            offset + ROUTE_SIDECAR_MAXIMUM_MATRIX_DESTINATIONS,
          );
          let result;
          try {
            result = await sidecar.walkingMatrix({
              origin,
              destinations: batch,
            });
          } catch {
            routes.push(...batch.map(() => unavailableWalkingRoute()));
            continue;
          }
          if (!result.ok) {
            routes.push(...batch.map(() => unavailableWalkingRoute()));
            continue;
          }
          for (let index = 0; index < batch.length; index += 1) {
            const route = result.evidence.routes.find(
              ({ destinationIndex }) => destinationIndex === index,
            );
            routes.push(
              route &&
                route.durationSeconds !== null &&
                route.distanceMeters !== null
                ? {
                    status: 'fresh' as const,
                    durationSeconds: route.durationSeconds,
                    distanceMeters: route.distanceMeters,
                    checkedAt: result.evidence.checkedAt,
                    attribution: result.evidence.attribution,
                  }
                : {
                    status: 'unavailable' as const,
                    warning: 'Walking route is unavailable.',
                  },
            );
          }
        }
        return routes;
      },
    },
    transitRouteProvider: {
      coverage(origin) {
        return isJapanTransitArea(origin) ? 'unsupported_region' : 'supported';
      },
      async transit(origin, destination) {
        let result;
        try {
          result = await sidecar.transit({ origin, destination });
        } catch {
          return unavailableTransitRoute();
        }
        if (!result.ok)
          return result.error === 'unsupported_region'
            ? {
                status: 'unavailable',
                reason: 'unsupported_region',
                warning:
                  'Japan train routes are unavailable from this provider.',
              }
            : unavailableTransitRoute();
        const { evidence } = result;
        if (!evidence.directRoute)
          return {
            status: 'no_direct_route',
            checkedAt: evidence.checkedAt,
            attribution: evidence.attribution,
          };
        return {
          status: 'fresh',
          durationSeconds: evidence.directRoute.durationSeconds,
          boardingCount: 1,
          lineIdentities: [evidence.directRoute.lineIdentity],
          transferCount: 0,
          checkedAt: evidence.checkedAt,
          attribution: evidence.attribution,
        };
      },
    },
  };
}

function unavailableTransitRoute() {
  return {
    status: 'unavailable' as const,
    warning: 'Transit route is temporarily unavailable.',
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
