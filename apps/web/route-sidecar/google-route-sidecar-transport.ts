import { mapGoogleGeocodingResponse } from '../adapters/providers/google-provider-response-mappers.ts';
import { mapGoogleRouteMatrixResponse } from '../adapters/providers/google-route-matrix-response-mapper.ts';
import {
  isRouteSidecarGeocodeRequest,
  isRouteSidecarWalkingMatrixRequest,
  type RouteSidecarGeocodeRequest,
  type RouteSidecarPoint,
  type RouteSidecarWalkingMatrixRequest,
} from './route-sidecar-contract.ts';

export const GOOGLE_ROUTE_SIDECAR_ENDPOINTS = {
  geocoding: 'https://maps.googleapis.com/maps/api/geocode/json',
  walkingMatrix:
    'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
} as const;

const walkingMatrixFieldMask = [
  'originIndex',
  'destinationIndex',
  'status',
  'condition',
  'distanceMeters',
  'duration',
].join(',');

export interface GoogleRouteSidecarTransport {
  geocode(
    request: RouteSidecarGeocodeRequest,
  ): Promise<RouteSidecarTransportResponse>;
  walkingMatrix(
    request: RouteSidecarWalkingMatrixRequest,
  ): Promise<RouteSidecarTransportResponse>;
}

interface RouteSidecarTransportResponse {
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
}

export function createGoogleRouteSidecarTransport(input: {
  readonly apiKey: string | undefined;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
}): GoogleRouteSidecarTransport {
  return {
    async geocode(request) {
      if (!isRouteSidecarGeocodeRequest(request)) return invalid();
      const query = new URLSearchParams({
        address: request.locationHint,
        region: 'jp',
        components: 'country:JP',
      });
      return execute(
        input,
        `${GOOGLE_ROUTE_SIDECAR_ENDPOINTS.geocoding}?${query}`,
        { method: 'GET' },
        (raw) => {
          const mapped = mapGoogleGeocodingResponse(raw);
          return mapped ? { ...mapped } : undefined;
        },
      );
    },
    async walkingMatrix(request) {
      if (!isRouteSidecarWalkingMatrixRequest(request)) return invalid();
      return execute(
        input,
        `${GOOGLE_ROUTE_SIDECAR_ENDPOINTS.walkingMatrix}?fields=${encodeURIComponent(walkingMatrixFieldMask)}`,
        {
          method: 'POST',
          body: JSON.stringify({
            origins: [matrixWaypoint(request.origin)],
            destinations: request.destinations.map(matrixWaypoint),
            travelMode: 'WALK',
            languageCode: 'ja',
            regionCode: 'JP',
            units: 'METRIC',
          }),
        },
        (raw) => {
          const mapped = mapGoogleRouteMatrixResponse(
            raw,
            request.destinations.length,
          );
          return mapped ? { ...mapped } : undefined;
        },
      );
    },
  };
}

async function execute(
  input: {
    readonly apiKey: string | undefined;
    readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  },
  url: string,
  init: { readonly method: 'GET' | 'POST'; readonly body?: string },
  map: (raw: unknown) => Readonly<Record<string, unknown>> | undefined,
): Promise<RouteSidecarTransportResponse> {
  if (!isConfiguredSecret(input.apiKey)) return notConfigured();
  let response: Response;
  try {
    response = await input.fetch(url, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': input.apiKey,
      },
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch {
    return unavailable();
  }
  if (response.status < 200 || response.status >= 300) return unavailable();
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    return unavailable();
  }
  const body = map(raw);
  return body ? { status: 200, body } : unavailable();
}

function matrixWaypoint(point: RouteSidecarPoint) {
  return {
    waypoint: {
      location: {
        latLng: {
          latitude: point.latitude,
          longitude: point.longitude,
        },
      },
    },
  };
}

function isConfiguredSecret(value: string | undefined): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 512 &&
    !value.startsWith('<')
  );
}

function invalid(): RouteSidecarTransportResponse {
  return { status: 400, body: {} };
}

function notConfigured(): RouteSidecarTransportResponse {
  return { status: 503, body: {} };
}

function unavailable(): RouteSidecarTransportResponse {
  return { status: 502, body: {} };
}
