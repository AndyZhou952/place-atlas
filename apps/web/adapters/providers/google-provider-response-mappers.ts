export interface GoogleGeocodingFields {
  readonly formattedAddress: readonly string[];
  readonly coordinates: readonly {
    readonly latitude: number;
    readonly longitude: number;
  }[];
}

export interface GoogleRoutesFields {
  readonly routeDurationSeconds: number;
  readonly routeDistanceMeters: number;
}

export function mapGoogleGeocodingResponse(
  payload: unknown,
): GoogleGeocodingFields | undefined {
  const record = asRecord(payload);
  if (!record || !Array.isArray(record.results)) return undefined;
  if (
    (record.status !== 'OK' && record.status !== 'ZERO_RESULTS') ||
    (record.status === 'OK' && record.results.length === 0) ||
    (record.status === 'ZERO_RESULTS' && record.results.length !== 0)
  ) {
    return undefined;
  }

  const formattedAddress: string[] = [];
  const coordinates: {
    readonly latitude: number;
    readonly longitude: number;
  }[] = [];
  for (const candidate of record.results) {
    const result = asRecord(candidate);
    const geometry = asRecord(result?.geometry);
    const location = asRecord(geometry?.location);
    if (
      !result ||
      typeof result.formatted_address !== 'string' ||
      result.formatted_address.trim().length === 0 ||
      !isLatitude(location?.lat) ||
      !isLongitude(location?.lng)
    ) {
      return undefined;
    }
    formattedAddress.push(result.formatted_address);
    coordinates.push({
      latitude: location.lat,
      longitude: location.lng,
    });
  }
  return { formattedAddress, coordinates };
}

export function mapGoogleRoutesResponse(
  payload: unknown,
): GoogleRoutesFields | undefined {
  const record = asRecord(payload);
  if (!record || !Array.isArray(record.routes) || record.routes.length === 0) {
    return undefined;
  }
  const route = asRecord(record.routes[0]);
  if (
    !route ||
    typeof route.duration !== 'string' ||
    !/^(?:0|[1-9]\d*)(?:\.\d+)?s$/u.test(route.duration) ||
    !isNonNegativeNumber(route.distanceMeters)
  ) {
    return undefined;
  }
  const durationSeconds = Number(route.duration.slice(0, -1));
  if (!Number.isFinite(durationSeconds)) return undefined;
  return {
    routeDurationSeconds: Math.ceil(durationSeconds),
    routeDistanceMeters: route.distanceMeters,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
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

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
