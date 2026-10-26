// Google Maps calls made by the route sidecar: geocoding a starting point (restricted to Japan) and
// a walking route matrix. Responses are checked field by field; anything unexpected is a
// dependency failure, logged without the request or the key.
import {
  GOOGLE_ROUTE_SIDECAR_ATTRIBUTION,
  GOOGLE_ROUTE_SIDECAR_PROVIDER_ID,
  isRecord,
  isRouteSidecarGeocodeRequest,
  isRouteSidecarPoint,
  isRouteSidecarWalkingMatrixRequest,
  type GoogleRouteSidecarPort,
  type RouteSidecarFailure,
  type RouteSidecarPoint,
} from './contract.ts';

export const GOOGLE_ROUTE_SIDECAR_ENDPOINTS = {
  geocoding: 'https://maps.googleapis.com/maps/api/geocode/json',
  walkingMatrix: 'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
} as const;

const walkingMatrixFieldMask =
  'originIndex,destinationIndex,status,condition,distanceMeters,duration';

export interface GoogleRouteSidecarServiceOptions {
  readonly apiKey: string | undefined;
  readonly clock: () => Date;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
}

type Operation = 'geocoding' | 'walking_matrix';

export function createGoogleRouteSidecarService(
  options: GoogleRouteSidecarServiceOptions,
): GoogleRouteSidecarPort {
  const evidenceBase = (endpoint: string) => {
    const checkedAt = options.clock();
    return Number.isFinite(checkedAt.getTime())
      ? {
          attribution: GOOGLE_ROUTE_SIDECAR_ATTRIBUTION,
          source: { providerId: GOOGLE_ROUTE_SIDECAR_PROVIDER_ID, endpoint },
          checkedAt: checkedAt.toISOString(),
        }
      : undefined;
  };
  return {
    async geocode(request) {
      if (!isRouteSidecarGeocodeRequest(request)) return failure('invalid_request');
      const query = new URLSearchParams({
        address: request.locationHint,
        region: 'jp',
        components: 'country:JP',
      });
      const raw = await call(
        options,
        'geocoding',
        `${GOOGLE_ROUTE_SIDECAR_ENDPOINTS.geocoding}?${query}`,
        { method: 'GET' },
      );
      if (!raw.ok) return raw;
      const candidates = geocodeCandidates(raw.value);
      const base = evidenceBase(GOOGLE_ROUTE_SIDECAR_ENDPOINTS.geocoding);
      if (!candidates || !base) return logged('geocoding', classifyGeocodeFailure(raw.value));
      return { ok: true, evidence: { candidates, ...base } };
    },
    async walkingMatrix(request) {
      if (!isRouteSidecarWalkingMatrixRequest(request)) return failure('invalid_request');
      const raw = await call(
        options,
        'walking_matrix',
        `${GOOGLE_ROUTE_SIDECAR_ENDPOINTS.walkingMatrix}?fields=${encodeURIComponent(walkingMatrixFieldMask)}`,
        {
          method: 'POST',
          body: JSON.stringify({
            origins: [waypoint(request.origin)],
            destinations: request.destinations.map(waypoint),
            travelMode: 'WALK',
            languageCode: 'ja',
            regionCode: 'JP',
            units: 'METRIC',
          }),
        },
      );
      if (!raw.ok) return raw;
      const routes = matrixRoutes(raw.value, request.destinations.length);
      const base = evidenceBase(GOOGLE_ROUTE_SIDECAR_ENDPOINTS.walkingMatrix);
      if (!routes || !base) return logged('walking_matrix', 'malformed_response');
      return { ok: true, evidence: { routes, ...base } };
    },
  };
}

/** One Google call: the key goes in the query for Geocoding and in a header for Routes. */
async function call(
  options: GoogleRouteSidecarServiceOptions,
  operation: Operation,
  url: string,
  init: { readonly method: 'GET' | 'POST'; readonly body?: string },
): Promise<{ readonly ok: true; readonly value: unknown } | RouteSidecarFailure> {
  const apiKey = options.apiKey;
  if (!apiKey || apiKey.length > 512 || apiKey.startsWith('<')) {
    console.warn('route_sidecar', { operation, resultClass: 'not_configured' });
    return failure('not_configured');
  }
  const requestUrl = new URL(url);
  if (operation === 'geocoding') requestUrl.searchParams.set('key', apiKey);
  let response: Response;
  try {
    response = await options.fetch(requestUrl.toString(), {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(operation === 'geocoding' ? {} : { 'x-goog-api-key': apiKey }),
      },
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch {
    return logged(operation, 'transport_unavailable');
  }
  if (response.status < 200 || response.status >= 300)
    return logged(
      operation,
      response.status === 401 || response.status === 403
        ? 'credential_rejected'
        : 'upstream_unavailable',
      `${String(response.status)[0]}xx`,
    );
  try {
    return { ok: true, value: await response.json() };
  } catch {
    return logged(operation, 'malformed_response');
  }
}

function geocodeCandidates(payload: unknown) {
  if (!isRecord(payload) || !Array.isArray(payload.results)) return undefined;
  const { status, results } = payload;
  if (
    (status !== 'OK' && status !== 'ZERO_RESULTS') ||
    (status === 'OK' && results.length === 0) ||
    (status === 'ZERO_RESULTS' && results.length !== 0) ||
    results.length > 3
  )
    return undefined;
  const candidates = results.map((result) => {
    const location =
      isRecord(result) && isRecord(result.geometry) ? result.geometry.location : undefined;
    const point = isRecord(location)
      ? { latitude: location.lat, longitude: location.lng }
      : undefined;
    return isRecord(result) &&
      typeof result.formatted_address === 'string' &&
      result.formatted_address.trim() &&
      isRouteSidecarPoint(point)
      ? { formattedAddress: result.formatted_address, point }
      : undefined;
  });
  return candidates.every(Boolean)
    ? (candidates as { formattedAddress: string; point: RouteSidecarPoint }[])
    : undefined;
}

function matrixRoutes(payload: unknown, destinationCount: number) {
  if (!Array.isArray(payload) || payload.length !== destinationCount) return undefined;
  const routes: ({
    destinationIndex: number;
    durationSeconds: number | null;
    distanceMeters: number | null;
  } | null)[] = Array.from({ length: destinationCount }, () => null);
  for (const element of payload) {
    if (
      !isRecord(element) ||
      element.originIndex !== 0 ||
      !Number.isInteger(element.destinationIndex) ||
      (element.destinationIndex as number) < 0 ||
      (element.destinationIndex as number) >= destinationCount ||
      routes[element.destinationIndex as number] !== null ||
      !isRecord(element.status) ||
      typeof element.condition !== 'string'
    )
      return undefined;
    const destinationIndex = element.destinationIndex as number;
    if ((element.status.code ?? 0) !== 0 || element.condition === 'ROUTE_NOT_FOUND') {
      routes[destinationIndex] = { destinationIndex, durationSeconds: null, distanceMeters: null };
      continue;
    }
    const seconds =
      typeof element.duration === 'string' && /^(?:0|[1-9]\d*)(?:\.\d+)?s$/u.test(element.duration)
        ? Number(element.duration.slice(0, -1))
        : NaN;
    const meters = element.distanceMeters;
    if (
      element.condition !== 'ROUTE_EXISTS' ||
      !Number.isFinite(seconds) ||
      typeof meters !== 'number' ||
      !Number.isFinite(meters) ||
      meters < 0
    )
      return undefined;
    routes[destinationIndex] = {
      destinationIndex,
      durationSeconds: Math.ceil(seconds),
      distanceMeters: meters,
    };
  }
  return routes.every(Boolean) ? (routes as NonNullable<(typeof routes)[number]>[]) : undefined;
}

function classifyGeocodeFailure(payload: unknown) {
  const status = isRecord(payload) ? payload.status : undefined;
  return status === 'REQUEST_DENIED'
    ? 'credential_rejected'
    : status === 'OVER_QUERY_LIMIT' || status === 'UNKNOWN_ERROR'
      ? 'upstream_unavailable'
      : 'malformed_response';
}

function waypoint(point: RouteSidecarPoint) {
  return {
    waypoint: { location: { latLng: { latitude: point.latitude, longitude: point.longitude } } },
  };
}

function logged(operation: Operation, resultClass: string, httpClass?: string) {
  console.warn('route_sidecar', { operation, resultClass, ...(httpClass ? { httpClass } : {}) });
  return failure('dependency_failure');
}

function failure(error: RouteSidecarFailure['error']): RouteSidecarFailure {
  return { ok: false, error };
}
