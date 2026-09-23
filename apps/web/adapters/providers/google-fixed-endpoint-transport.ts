import type {
  ProviderJsonObject,
  ProviderTransportResponse,
} from '../../product/provider-policy/provider-policy-gateway.ts';
import {
  mapGoogleGeocodingResponse,
  mapGoogleRoutesResponse,
} from './google-provider-response-mappers.ts';
import { mapGoogleRouteMatrixResponse } from './google-route-matrix-response-mapper.ts';
import { mapGoogleTransitResponse } from './google-transit-response-mapper.ts';

export const GOOGLE_FIXED_ENDPOINTS = {
  geocoding: 'https://maps.googleapis.com/maps/api/geocode/json',
  routeMatrix:
    'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
  routes: 'https://routes.googleapis.com/directions/v2:computeRoutes',
} as const;

const routeMatrixFieldMask = [
  'originIndex',
  'destinationIndex',
  'status',
  'condition',
  'distanceMeters',
  'duration',
].join(',');

type GoogleFixedEndpointRequest =
  | {
      readonly kind: 'geocoding';
      readonly query: {
        readonly address: string;
        readonly region: 'jp';
        readonly components: 'country:JP';
      };
      readonly fields: readonly ('formattedAddress' | 'coordinates')[];
    }
  | {
      readonly kind: 'route_matrix';
      readonly body: ProviderJsonObject;
      readonly fields: readonly (
        | 'routeDurationSeconds'
        | 'routeDistanceMeters'
      )[];
    }
  | {
      readonly kind: 'routes';
      readonly body: ProviderJsonObject;
      readonly fields: readonly (
        | 'routeDurationSeconds'
        | 'routeDistanceMeters'
        | 'transitLegs'
      )[];
    };

export interface GoogleFixedEndpointTransport {
  execute(
    request: GoogleFixedEndpointRequest,
  ): Promise<ProviderTransportResponse>;
}

export interface GoogleFixedEndpointTransportOptions {
  readonly apiKey: string | undefined;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
}

export function createGoogleFixedEndpointTransport({
  apiKey,
  fetch,
}: GoogleFixedEndpointTransportOptions): GoogleFixedEndpointTransport {
  return {
    async execute(request) {
      if (!isConfiguredSecret(apiKey)) return missingConfiguration();

      const prepared = prepareRequest(request);
      if (!prepared) return invalid();

      let response: Response;
      try {
        response = await fetch(prepared.url, {
          method: prepared.method,
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          redirect: 'manual',
          cache: 'no-store',
          ...(prepared.body ? { body: JSON.stringify(prepared.body) } : {}),
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
      const body = prepared.map(raw);
      return body ? { status: 200, headers: {}, body } : unavailable();
    },
  };
}

interface PreparedGoogleRequest {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly body?: ProviderJsonObject;
  readonly map: (raw: unknown) => Readonly<Record<string, unknown>> | undefined;
}

function prepareRequest(
  request: GoogleFixedEndpointRequest,
): PreparedGoogleRequest | undefined {
  if (request.kind === 'geocoding') {
    if (
      !hasExactly(request.fields, ['formattedAddress', 'coordinates']) ||
      !isGeocodingQuery(request.query)
    ) {
      return undefined;
    }
    const query = new URLSearchParams({
      address: request.query.address,
      region: request.query.region,
      components: request.query.components,
    });
    return {
      url: `${GOOGLE_FIXED_ENDPOINTS.geocoding}?${query}`,
      method: 'GET',
      map: (raw) => toTransportBody(mapGoogleGeocodingResponse(raw)),
    };
  }

  if (request.kind === 'route_matrix') {
    const body = normalizeRouteMatrixBody(request.body);
    if (
      !body ||
      !hasExactly(request.fields, [
        'routeDurationSeconds',
        'routeDistanceMeters',
      ])
    ) {
      return undefined;
    }
    return {
      url: `${GOOGLE_FIXED_ENDPOINTS.routeMatrix}?fields=${encodeURIComponent(routeMatrixFieldMask)}`,
      method: 'POST',
      body,
      map: (raw) =>
        toTransportBody(
          mapGoogleRouteMatrixResponse(raw, body.destinations.length),
        ),
    };
  }

  const body = normalizeRoutesBody(request.body);
  if (!body) return undefined;
  const transit = body.travelMode === 'TRANSIT';
  if (
    transit
      ? !hasExactly(request.fields, ['transitLegs'])
      : !hasExactly(request.fields, [
          'routeDurationSeconds',
          'routeDistanceMeters',
        ])
  ) {
    return undefined;
  }
  return {
    url: GOOGLE_FIXED_ENDPOINTS.routes,
    method: 'POST',
    body,
    map: transit
      ? (raw) => toTransportBody(mapGoogleTransitResponse(raw))
      : (raw) => toTransportBody(mapGoogleRoutesResponse(raw)),
  };
}

function toTransportBody(
  value: object | undefined,
): Readonly<Record<string, unknown>> | undefined {
  return value ? { ...value } : undefined;
}

function isGeocodingQuery(value: unknown): value is {
  readonly address: string;
  readonly region: 'jp';
  readonly components: 'country:JP';
} {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['address', 'region', 'components']) &&
    typeof value.address === 'string' &&
    value.address.trim().length > 0 &&
    value.address.length <= 512 &&
    value.region === 'jp' &&
    value.components === 'country:JP'
  );
}

function normalizeRouteMatrixBody(value: ProviderJsonObject):
  | (ProviderJsonObject & {
      readonly destinations: readonly ProviderJsonObject[];
    })
  | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'origins',
      'destinations',
      'travelMode',
      'languageCode',
      'regionCode',
      'units',
    ]) ||
    !Array.isArray(value.origins) ||
    value.origins.length !== 1 ||
    !Array.isArray(value.destinations) ||
    value.destinations.length < 1 ||
    value.destinations.length > 625 ||
    value.travelMode !== 'WALK' ||
    value.languageCode !== 'ja' ||
    value.regionCode !== 'JP' ||
    value.units !== 'METRIC'
  ) {
    return undefined;
  }
  const origin = normalizeMatrixWaypoint(value.origins[0]);
  const destinations = value.destinations.map(normalizeMatrixWaypoint);
  if (!origin || destinations.some((destination) => !destination)) {
    return undefined;
  }
  return {
    origins: [origin],
    destinations: destinations as ProviderJsonObject[],
    travelMode: 'WALK',
    languageCode: 'ja',
    regionCode: 'JP',
    units: 'METRIC',
  };
}

function normalizeMatrixWaypoint(
  value: unknown,
): ProviderJsonObject | undefined {
  const waypoint = isRecord(value) ? value.waypoint : undefined;
  const location = isRecord(waypoint) ? waypoint.location : undefined;
  const latLng = isRecord(location) ? location.latLng : undefined;
  const point = normalizePoint(latLng);
  return point ? { waypoint: { location: { latLng: point } } } : undefined;
}

function normalizeRoutesBody(
  value: ProviderJsonObject,
): ProviderJsonObject | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'origin',
      'destination',
      'travelMode',
      'languageCode',
      'units',
    ]) ||
    (value.travelMode !== 'WALK' && value.travelMode !== 'TRANSIT') ||
    value.languageCode !== 'ja' ||
    value.units !== 'METRIC'
  ) {
    return undefined;
  }
  const origin = normalizeRouteWaypoint(value.origin);
  const destination = normalizeRouteWaypoint(value.destination);
  return origin && destination
    ? {
        origin,
        destination,
        travelMode: value.travelMode,
        languageCode: 'ja',
        units: 'METRIC',
      }
    : undefined;
}

function normalizeRouteWaypoint(
  value: unknown,
): ProviderJsonObject | undefined {
  const location = isRecord(value) ? value.location : undefined;
  const point = normalizePoint(
    isRecord(location) ? location.latLng : undefined,
  );
  return point ? { location: { latLng: point } } : undefined;
}

function normalizePoint(value: unknown): ProviderJsonObject | undefined {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['latitude', 'longitude']) ||
    !isLatitude(value.latitude) ||
    !isLongitude(value.longitude)
  ) {
    return undefined;
  }
  return { latitude: value.latitude, longitude: value.longitude };
}

function hasExactly(
  values: readonly string[],
  expected: readonly string[],
): boolean {
  return (
    values.length === expected.length &&
    new Set(values).size === values.length &&
    expected.every((value) => values.includes(value))
  );
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return hasExactly(Object.keys(value), keys);
}

function isLatitude(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= -90 &&
    value <= 90
  );
}

function isLongitude(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= -180 &&
    value <= 180
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isConfiguredSecret(value: string | undefined): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 512 &&
    !value.startsWith('<')
  );
}

function invalid(): ProviderTransportResponse {
  return { status: 400, headers: {}, body: {} };
}

function unavailable(): ProviderTransportResponse {
  return { status: 502, headers: {}, body: {} };
}

function missingConfiguration(): ProviderTransportResponse {
  return { status: 503, headers: {}, body: {} };
}
