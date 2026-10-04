import { mapGoogleGeocodingResponse } from '../adapters/providers/google-provider-response-mappers.ts';
import { mapGoogleRouteMatrixResponse } from '../adapters/providers/google-route-matrix-response-mapper.ts';
import { mapGoogleTransitRouteResponse } from '../adapters/providers/google-transit-route-response-mapper.ts';
import {
  isRouteSidecarGeocodeRequest,
  isRouteSidecarWalkingMatrixRequest,
  isRouteSidecarTransitRequest,
  type RouteSidecarGeocodeRequest,
  type RouteSidecarPoint,
  type RouteSidecarWalkingMatrixRequest,
  type RouteSidecarTransitRequest,
} from './route-sidecar-contract.ts';
import {
  noOpNearbyDiagnosticRecorder,
  type NearbyDiagnosticRecorder,
} from './nearby-diagnostic-recorder.ts';

export const GOOGLE_ROUTE_SIDECAR_ENDPOINTS = {
  geocoding: 'https://maps.googleapis.com/maps/api/geocode/json',
  walkingMatrix:
    'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
  transit: 'https://routes.googleapis.com/directions/v2:computeRoutes',
} as const;

const walkingMatrixFieldMask = [
  'originIndex',
  'destinationIndex',
  'status',
  'condition',
  'distanceMeters',
  'duration',
].join(',');

const transitFieldMask = [
  'routes.duration',
  'routes.legs.steps.travelMode',
  'routes.legs.steps.transitDetails.transitLine.name',
  'routes.legs.steps.transitDetails.transitLine.vehicle.type',
].join(',');

export interface GoogleRouteSidecarTransport {
  geocode(
    request: RouteSidecarGeocodeRequest,
  ): Promise<RouteSidecarTransportResponse>;
  walkingMatrix(
    request: RouteSidecarWalkingMatrixRequest,
  ): Promise<RouteSidecarTransportResponse>;
  transit(
    request: RouteSidecarTransitRequest,
  ): Promise<RouteSidecarTransportResponse>;
}

interface RouteSidecarTransportResponse {
  readonly status: number;
  readonly body: Readonly<Record<string, unknown>>;
}

export function createGoogleRouteSidecarTransport(input: {
  readonly apiKey: string | undefined;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  readonly diagnosticRecorder?: NearbyDiagnosticRecorder;
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
        'query',
        'geocoding',
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
        'header',
        'walking_matrix',
        (raw) => {
          const mapped = mapGoogleRouteMatrixResponse(
            raw,
            request.destinations.length,
          );
          return mapped ? { ...mapped } : undefined;
        },
      );
    },
    async transit(request) {
      if (!isRouteSidecarTransitRequest(request)) return invalid();
      return execute(
        input,
        `${GOOGLE_ROUTE_SIDECAR_ENDPOINTS.transit}?fields=${encodeURIComponent(transitFieldMask)}`,
        {
          method: 'POST',
          body: JSON.stringify({
            origin: routeWaypoint(request.origin),
            destination: routeWaypoint(request.destination),
            travelMode: 'TRANSIT',
            computeAlternativeRoutes: true,
            transitPreferences: {
              allowedTravelModes: ['SUBWAY', 'TRAIN', 'LIGHT_RAIL', 'RAIL'],
              routingPreference: 'FEWER_TRANSFERS',
            },
            languageCode: 'ja',
            regionCode: 'JP',
          }),
        },
        'header',
        'transit',
        (raw) => mapGoogleTransitRouteResponse(raw),
      );
    },
  };
}

async function execute(
  input: {
    readonly apiKey: string | undefined;
    readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
    readonly diagnosticRecorder?: NearbyDiagnosticRecorder;
  },
  url: string,
  init: { readonly method: 'GET' | 'POST'; readonly body?: string },
  credential: 'query' | 'header',
  operation: 'geocoding' | 'walking_matrix' | 'transit',
  map: (raw: unknown) => Readonly<Record<string, unknown>> | undefined,
): Promise<RouteSidecarTransportResponse> {
  const diagnostics = input.diagnosticRecorder ?? noOpNearbyDiagnosticRecorder;
  if (!isConfiguredSecret(input.apiKey)) {
    diagnostics.record({
      layer: 'sidecar_transport',
      operation,
      endpoint: operation,
      resultClass: 'not_configured',
    });
    return notConfigured();
  }
  const requestUrl =
    credential === 'query' ? withApiKeyQuery(url, input.apiKey) : url;
  let response: Response;
  try {
    response = await input.fetch(requestUrl, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(credential === 'header' ? { 'x-goog-api-key': input.apiKey } : {}),
      },
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch {
    diagnostics.record(sidecarDiagnostic(operation, 'transport_unavailable'));
    return unavailable();
  }
  if (response.status >= 300 && response.status < 400) {
    diagnostics.record(
      sidecarDiagnostic(operation, 'transport_unavailable', '3xx'),
    );
    return unavailable();
  }
  if (response.status < 200 || response.status >= 300) {
    diagnostics.record(
      sidecarDiagnostic(
        operation,
        response.status === 401 || response.status === 403
          ? 'credential_rejected'
          : 'upstream_unavailable',
        httpClass(response.status),
      ),
    );
    return unavailable();
  }
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    diagnostics.record(sidecarDiagnostic(operation, 'malformed_response'));
    return unavailable();
  }
  const body = map(raw);
  if (!body) {
    diagnostics.record(
      sidecarDiagnostic(operation, classifyMappedFailure(operation, raw)),
    );
    return unavailable();
  }
  if (operation === 'geocoding' && geocodingStatus(raw) === 'ZERO_RESULTS') {
    diagnostics.record(sidecarDiagnostic(operation, 'not_found'));
  } else {
    diagnostics.record(sidecarDiagnostic(operation, 'success', '2xx'));
  }
  return { status: 200, body };
}

function sidecarDiagnostic(
  operation: 'geocoding' | 'walking_matrix' | 'transit',
  resultClass:
    | 'credential_rejected'
    | 'transport_unavailable'
    | 'upstream_unavailable'
    | 'malformed_response'
    | 'success'
    | 'not_found',
  httpClassValue?: '2xx' | '3xx' | '4xx' | '5xx',
) {
  return {
    layer: 'sidecar_transport' as const,
    operation,
    endpoint: operation,
    resultClass,
    ...(httpClassValue === undefined ? {} : { httpClass: httpClassValue }),
  };
}

function classifyMappedFailure(
  operation: 'geocoding' | 'walking_matrix' | 'transit',
  raw: unknown,
): 'credential_rejected' | 'upstream_unavailable' | 'malformed_response' {
  if (operation !== 'geocoding') return 'malformed_response';
  const status = geocodingStatus(raw);
  if (status === 'REQUEST_DENIED') return 'credential_rejected';
  return status === 'OVER_QUERY_LIMIT' || status === 'UNKNOWN_ERROR'
    ? 'upstream_unavailable'
    : 'malformed_response';
}

function geocodingStatus(raw: unknown): unknown {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw as Readonly<Record<string, unknown>>).status
    : undefined;
}

function httpClass(status: number): '3xx' | '4xx' | '5xx' | undefined {
  if (status >= 300 && status < 400) return '3xx';
  if (status >= 400 && status < 500) return '4xx';
  if (status >= 500 && status < 600) return '5xx';
  return undefined;
}

function withApiKeyQuery(url: string, apiKey: string): string {
  const requestUrl = new URL(url);
  requestUrl.searchParams.set('key', apiKey);
  return requestUrl.toString();
}

function matrixWaypoint(point: RouteSidecarPoint) {
  return {
    waypoint: routeWaypoint(point),
  };
}

function routeWaypoint(point: RouteSidecarPoint) {
  return {
    location: {
      latLng: {
        latitude: point.latitude,
        longitude: point.longitude,
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
