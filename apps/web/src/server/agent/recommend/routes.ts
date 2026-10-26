// Starting points and walking times for Recommend, through the route sidecar Worker. Every call
// first reserves this month's quota in D1. Train times are not offered: Google returns no transit
// routes in Japan, so the service answers those requests with a fixed message instead.
import {
  GOOGLE_ROUTE_SIDECAR_PROVIDER_ID,
  isRouteSidecarGeocodeRequest,
  isRouteSidecarWalkingMatrixRequest,
  ROUTE_SIDECAR_MAXIMUM_MATRIX_DESTINATIONS,
  type GoogleRouteSidecarPort,
  type RouteSidecarFailure,
} from '../../../../route-sidecar/contract.ts';
import type { UsageReservation } from '../discovery/quota.ts';

export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
}

export interface ResolvedLocation {
  readonly canonicalAddress: string;
  readonly point: GeoPoint;
}

export type LocationResolution =
  | { readonly status: 'resolved'; readonly location: ResolvedLocation }
  | { readonly status: 'ambiguous'; readonly candidates: readonly ResolvedLocation[] }
  | {
      readonly status: 'unresolved';
      readonly reason: 'not_found' | 'dependency_failure';
      readonly warning: string;
    };

export interface LocationResolver {
  resolve(locationHint: string): Promise<LocationResolution>;
}

export type WalkingRouteEvidence =
  | {
      readonly status: 'fresh';
      readonly durationSeconds: number;
      readonly distanceMeters: number;
      readonly checkedAt: string;
      readonly attribution: { readonly label: string; readonly url: string };
    }
  | {
      readonly status: 'stale';
      readonly checkedAt: string;
      readonly attribution: { readonly label: string; readonly url: string };
      readonly warning: string;
    }
  | { readonly status: 'unavailable'; readonly warning: string };

export interface RouteProvider {
  walking(origin: GeoPoint, destination: GeoPoint): Promise<WalkingRouteEvidence>;
  walkingMany?(
    origin: GeoPoint,
    destinations: readonly GeoPoint[],
  ): Promise<readonly WalkingRouteEvidence[]>;
}

export type RouteSidecarServiceBinding = GoogleRouteSidecarPort;

export interface RouteUsagePort {
  reserve(reservation: UsageReservation): Promise<'reserved' | 'quota_exceeded' | 'cost_exceeded'>;
}

const monthlyLimit = 8_000;

/** The sidecar behind monthly caps: a refused reservation never reaches Google. */
export function createMeteredRouteSidecarClient(options: {
  readonly service: GoogleRouteSidecarPort | undefined;
  readonly usage: RouteUsagePort;
}): GoogleRouteSidecarPort {
  const metered = async <T>(
    sku: 'geocoding.requests' | 'walking_matrix.elements',
    units: number,
    invoke: (service: GoogleRouteSidecarPort) => Promise<T>,
  ): Promise<T | RouteSidecarFailure> => {
    const service = options.service;
    if (!service) return { ok: false, error: 'not_configured' };
    try {
      const reserved = await options.usage.reserve({
        providerId: GOOGLE_ROUTE_SIDECAR_PROVIDER_ID,
        sku,
        units,
        requests: 1,
        costUsd: 0,
        hardRequestLimit: monthlyLimit,
        hardUnitLimit: monthlyLimit,
        hardCostLimitUsd: 0,
      });
      if (reserved !== 'reserved') return { ok: false, error: 'quota_exceeded' };
    } catch {
      return { ok: false, error: 'quota_exceeded' };
    }
    try {
      return await invoke(service);
    } catch {
      return { ok: false, error: 'dependency_failure' };
    }
  };
  return {
    geocode: (request) =>
      isRouteSidecarGeocodeRequest(request)
        ? metered('geocoding.requests', 1, (service) => service.geocode(request))
        : Promise.resolve({ ok: false, error: 'invalid_request' }),
    walkingMatrix: (request) =>
      isRouteSidecarWalkingMatrixRequest(request)
        ? metered('walking_matrix.elements', request.destinations.length, (service) =>
            service.walkingMatrix(request),
          )
        : Promise.resolve({ ok: false, error: 'invalid_request' }),
  };
}

export function createRouteSidecarRoutes(sidecar: GoogleRouteSidecarPort): {
  readonly locationResolver: LocationResolver;
  readonly routeProvider: RouteProvider;
} {
  const lookupFailed = {
    status: 'unresolved' as const,
    reason: 'dependency_failure' as const,
    warning: 'Address lookup is temporarily unavailable.',
  };
  const walkFailed = {
    status: 'unavailable' as const,
    warning: 'Walking route is temporarily unavailable.',
  };
  const routeProvider: RouteProvider = {
    async walking(origin, destination) {
      return (await routeProvider.walkingMany!(origin, [destination]))[0];
    },
    async walkingMany(origin, destinations) {
      const routes: WalkingRouteEvidence[] = [];
      for (
        let offset = 0;
        offset < destinations.length;
        offset += ROUTE_SIDECAR_MAXIMUM_MATRIX_DESTINATIONS
      ) {
        const batch = destinations.slice(
          offset,
          offset + ROUTE_SIDECAR_MAXIMUM_MATRIX_DESTINATIONS,
        );
        const result = await sidecar
          .walkingMatrix({ origin, destinations: batch })
          .catch(() => undefined);
        if (!result?.ok) {
          routes.push(...batch.map(() => walkFailed));
          continue;
        }
        for (let index = 0; index < batch.length; index += 1) {
          const route = result.evidence.routes.find(
            ({ destinationIndex }) => destinationIndex === index,
          );
          routes.push(
            route && route.durationSeconds !== null && route.distanceMeters !== null
              ? {
                  status: 'fresh',
                  durationSeconds: route.durationSeconds,
                  distanceMeters: route.distanceMeters,
                  checkedAt: result.evidence.checkedAt,
                  attribution: result.evidence.attribution,
                }
              : { status: 'unavailable', warning: 'Walking route is unavailable.' },
          );
        }
      }
      return routes;
    },
  };
  return {
    locationResolver: {
      async resolve(locationHint) {
        const result = await sidecar.geocode({ locationHint }).catch(() => undefined);
        if (!result?.ok) return lookupFailed;
        const candidates = result.evidence.candidates.map(({ formattedAddress, point }) => ({
          canonicalAddress: formattedAddress,
          point: { latitude: point.latitude, longitude: point.longitude },
        }));
        if (candidates.length === 0)
          return {
            status: 'unresolved',
            reason: 'not_found',
            warning: 'The location could not be resolved.',
          };
        return candidates.length > 1
          ? { status: 'ambiguous', candidates }
          : { status: 'resolved', location: candidates[0] };
      },
    },
    routeProvider,
  };
}
