import {
  createGoogleRouteSidecarTransport,
  GOOGLE_ROUTE_SIDECAR_ENDPOINTS,
} from './google-route-sidecar-transport.ts';
import {
  GOOGLE_ROUTE_SIDECAR_ATTRIBUTION,
  GOOGLE_ROUTE_SIDECAR_PROVIDER_ID,
  isRouteSidecarGeocodeRequest,
  isRouteSidecarPoint,
  isRouteSidecarWalkingMatrixRequest,
  isRouteSidecarTransitRequest,
  type GoogleRouteSidecarPort,
  type RouteSidecarFailure,
  type RouteSidecarGeocodeEvidence,
  type RouteSidecarGeocodeResult,
  type RouteSidecarWalkingMatrixEvidence,
  type RouteSidecarWalkingMatrixResult,
  type RouteSidecarTransitEvidence,
  type RouteSidecarTransitResult,
} from './route-sidecar-contract.ts';
import type { NearbyDiagnosticRecorder } from './nearby-diagnostic-recorder.ts';
import { isJapanTransitArea } from './transit-coverage.ts';

export interface GoogleRouteSidecarServiceOptions {
  readonly apiKey: string | undefined;
  readonly clock: () => Date;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly diagnosticRecorder?: NearbyDiagnosticRecorder;
}

export function createGoogleRouteSidecarService({
  apiKey,
  clock,
  fetch,
  diagnosticRecorder,
}: GoogleRouteSidecarServiceOptions): GoogleRouteSidecarPort {
  const transport = createGoogleRouteSidecarTransport({
    apiKey,
    fetch,
    diagnosticRecorder,
  });
  return {
    async geocode(request): Promise<RouteSidecarGeocodeResult> {
      if (!isRouteSidecarGeocodeRequest(request)) {
        return failure('invalid_request');
      }
      const response = await transport.geocode(request);
      if (response.status !== 200) return transportFailure(response.status);
      const evidence = mapGeocodeEvidence(response.body, clock());
      return evidence ? { ok: true, evidence } : failure('dependency_failure');
    },
    async walkingMatrix(request): Promise<RouteSidecarWalkingMatrixResult> {
      if (!isRouteSidecarWalkingMatrixRequest(request)) {
        return failure('invalid_request');
      }
      const response = await transport.walkingMatrix(request);
      if (response.status !== 200) return transportFailure(response.status);
      const evidence = mapWalkingMatrixEvidence(
        response.body,
        request.destinations.length,
        clock(),
      );
      return evidence ? { ok: true, evidence } : failure('dependency_failure');
    },
    async transit(request): Promise<RouteSidecarTransitResult> {
      if (!isRouteSidecarTransitRequest(request)) return failure('invalid_request');
      if (isJapanTransitArea(request.origin) || isJapanTransitArea(request.destination))
        return failure('unsupported_region');
      const response = await transport.transit(request);
      if (response.status !== 200) return transportFailure(response.status);
      const evidence = mapTransitEvidence(response.body, clock());
      return evidence ? { ok: true, evidence } : failure('dependency_failure');
    },
  };
}

function mapTransitEvidence(
  body: Readonly<Record<string, unknown>>,
  checkedAt: Date,
): RouteSidecarTransitEvidence | undefined {
  if (!isValidDate(checkedAt)) return undefined;
  const route = body.directRoute;
  if (
    route !== null &&
    (!route ||
      typeof route !== 'object' ||
      Array.isArray(route) ||
      typeof (route as Record<string, unknown>).durationSeconds !== 'number' ||
      !Number.isFinite((route as Record<string, unknown>).durationSeconds) ||
      (route as Record<string, number>).durationSeconds <= 0 ||
      typeof (route as Record<string, unknown>).lineIdentity !== 'string' ||
      !(route as Record<string, string>).lineIdentity.trim())
  )
    return undefined;
  return {
    directRoute: route as RouteSidecarTransitEvidence['directRoute'],
    attribution: GOOGLE_ROUTE_SIDECAR_ATTRIBUTION,
    source: {
      providerId: GOOGLE_ROUTE_SIDECAR_PROVIDER_ID,
      endpoint: GOOGLE_ROUTE_SIDECAR_ENDPOINTS.transit,
    },
    checkedAt: checkedAt.toISOString(),
  };
}

function mapWalkingMatrixEvidence(
  body: Readonly<Record<string, unknown>>,
  destinationCount: number,
  checkedAt: Date,
): RouteSidecarWalkingMatrixEvidence | undefined {
  const durations = body.routeDurationSeconds;
  const distances = body.routeDistanceMeters;
  if (
    !isRouteValues(durations, destinationCount) ||
    !isRouteValues(distances, destinationCount) ||
    !isValidDate(checkedAt)
  ) {
    return undefined;
  }
  const routes = durations.map((durationSeconds, destinationIndex) => {
    const distanceMeters = distances[destinationIndex];
    return durationSeconds === null || distanceMeters === null
      ? { destinationIndex, durationSeconds: null, distanceMeters: null }
      : { destinationIndex, durationSeconds, distanceMeters };
  });
  return {
    routes,
    attribution: GOOGLE_ROUTE_SIDECAR_ATTRIBUTION,
    source: {
      providerId: GOOGLE_ROUTE_SIDECAR_PROVIDER_ID,
      endpoint: GOOGLE_ROUTE_SIDECAR_ENDPOINTS.walkingMatrix,
    },
    checkedAt: checkedAt.toISOString(),
  };
}

function mapGeocodeEvidence(
  body: Readonly<Record<string, unknown>>,
  checkedAt: Date,
): RouteSidecarGeocodeEvidence | undefined {
  const addresses = body.formattedAddress;
  const coordinates = body.coordinates;
  if (
    !Array.isArray(addresses) ||
    !Array.isArray(coordinates) ||
    addresses.length !== coordinates.length ||
    addresses.length > 3 ||
    !isValidDate(checkedAt)
  ) {
    return undefined;
  }
  const candidates = addresses.flatMap((formattedAddress, index) => {
    const point = coordinates[index];
    return typeof formattedAddress === 'string' &&
      formattedAddress.trim().length > 0 &&
      isRouteSidecarPoint(point)
      ? [{ formattedAddress, point }]
      : [];
  });
  if (candidates.length !== addresses.length) return undefined;
  return {
    candidates,
    attribution: GOOGLE_ROUTE_SIDECAR_ATTRIBUTION,
    source: {
      providerId: GOOGLE_ROUTE_SIDECAR_PROVIDER_ID,
      endpoint: GOOGLE_ROUTE_SIDECAR_ENDPOINTS.geocoding,
    },
    checkedAt: checkedAt.toISOString(),
  };
}

function isValidDate(value: Date): boolean {
  return Number.isFinite(value.getTime());
}

function isRouteValues(
  value: unknown,
  expectedLength: number,
): value is readonly (number | null)[] {
  return (
    Array.isArray(value) &&
    value.length === expectedLength &&
    value.every(
      (candidate) =>
        candidate === null ||
        (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0),
    )
  );
}

function transportFailure(status: number): RouteSidecarFailure {
  return status === 400
    ? failure('invalid_request')
    : status === 503
      ? failure('not_configured')
      : failure('dependency_failure');
}

function failure(error: RouteSidecarFailure['error']): RouteSidecarFailure {
  return { ok: false, error };
}
