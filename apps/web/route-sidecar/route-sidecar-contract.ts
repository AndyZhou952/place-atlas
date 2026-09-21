export const GOOGLE_ROUTE_SIDECAR_PROVIDER_ID = 'google-maps-platform' as const;

export const GOOGLE_ROUTE_SIDECAR_ATTRIBUTION = {
  label: 'Google Maps',
  url: 'https://www.google.com/maps',
} as const;

export const ROUTE_SIDECAR_MAXIMUM_MATRIX_DESTINATIONS = 25;

export interface RouteSidecarPoint {
  readonly latitude: number;
  readonly longitude: number;
}

export interface RouteSidecarGeocodeRequest {
  readonly locationHint: string;
}

export interface RouteSidecarGeocodeEvidence {
  readonly candidates: readonly {
    readonly formattedAddress: string;
    readonly point: RouteSidecarPoint;
  }[];
  readonly attribution: typeof GOOGLE_ROUTE_SIDECAR_ATTRIBUTION;
  readonly source: {
    readonly providerId: typeof GOOGLE_ROUTE_SIDECAR_PROVIDER_ID;
    readonly endpoint: string;
  };
  readonly checkedAt: string;
}

export interface RouteSidecarWalkingMatrixRequest {
  readonly origin: RouteSidecarPoint;
  readonly destinations: readonly RouteSidecarPoint[];
}

export interface RouteSidecarWalkingMatrixEvidence {
  readonly routes: readonly {
    readonly destinationIndex: number;
    readonly durationSeconds: number | null;
    readonly distanceMeters: number | null;
  }[];
  readonly attribution: typeof GOOGLE_ROUTE_SIDECAR_ATTRIBUTION;
  readonly source: {
    readonly providerId: typeof GOOGLE_ROUTE_SIDECAR_PROVIDER_ID;
    readonly endpoint: string;
  };
  readonly checkedAt: string;
}

export type RouteSidecarFailure = {
  readonly ok: false;
  readonly error:
    | 'invalid_request'
    | 'not_configured'
    | 'dependency_failure'
    | 'quota_exceeded';
};

export type RouteSidecarGeocodeResult =
  | {
      readonly ok: true;
      readonly evidence: RouteSidecarGeocodeEvidence;
    }
  | RouteSidecarFailure;

export type RouteSidecarWalkingMatrixResult =
  | {
      readonly ok: true;
      readonly evidence: RouteSidecarWalkingMatrixEvidence;
    }
  | RouteSidecarFailure;

export interface GoogleRouteSidecarPort {
  geocode(
    request: RouteSidecarGeocodeRequest,
  ): Promise<RouteSidecarGeocodeResult>;
  walkingMatrix(
    request: RouteSidecarWalkingMatrixRequest,
  ): Promise<RouteSidecarWalkingMatrixResult>;
}

export function isRouteSidecarGeocodeRequest(
  value: unknown,
): value is RouteSidecarGeocodeRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['locationHint']) &&
    typeof value.locationHint === 'string' &&
    value.locationHint.trim().length > 0 &&
    value.locationHint.length <= 512
  );
}

export function isRouteSidecarWalkingMatrixRequest(
  value: unknown,
): value is RouteSidecarWalkingMatrixRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['origin', 'destinations']) &&
    isRouteSidecarPoint(value.origin) &&
    Array.isArray(value.destinations) &&
    value.destinations.length >= 1 &&
    value.destinations.length <= ROUTE_SIDECAR_MAXIMUM_MATRIX_DESTINATIONS &&
    value.destinations.every(isRouteSidecarPoint)
  );
}

export function isRouteSidecarPoint(
  value: unknown,
): value is RouteSidecarPoint {
  return (
    isRecord(value) &&
    hasExactKeys(value, ['latitude', 'longitude']) &&
    typeof value.latitude === 'number' &&
    Number.isFinite(value.latitude) &&
    value.latitude >= -90 &&
    value.latitude <= 90 &&
    typeof value.longitude === 'number' &&
    Number.isFinite(value.longitude) &&
    value.longitude >= -180 &&
    value.longitude <= 180
  );
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && keys.every((key) => actual.includes(key))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
