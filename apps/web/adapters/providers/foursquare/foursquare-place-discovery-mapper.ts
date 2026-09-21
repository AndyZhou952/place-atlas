export interface FoursquarePlaceFields {
  readonly fsqPlaceId: readonly string[];
  readonly name: readonly string[];
  readonly formattedAddress: readonly string[];
  readonly coordinates: readonly {
    readonly latitude: number;
    readonly longitude: number;
  }[];
}

export function mapFoursquarePlacesResponse(
  payload: unknown,
): FoursquarePlaceFields | undefined {
  const response = asRecord(payload);
  if (!response || !Array.isArray(response.results)) return undefined;

  const fsqPlaceId: string[] = [];
  const name: string[] = [];
  const formattedAddress: string[] = [];
  const coordinates: {
    readonly latitude: number;
    readonly longitude: number;
  }[] = [];
  for (const rawCandidate of response.results) {
    const candidate = asRecord(rawCandidate);
    const location = asRecord(candidate?.location);
    if (
      !candidate ||
      !nonEmptyString(candidate.fsq_place_id) ||
      !nonEmptyString(candidate.name) ||
      !nonEmptyString(location?.formatted_address) ||
      !isLatitude(candidate.latitude) ||
      !isLongitude(candidate.longitude)
    ) {
      return undefined;
    }
    fsqPlaceId.push(candidate.fsq_place_id);
    name.push(candidate.name);
    formattedAddress.push(location.formatted_address);
    coordinates.push({
      latitude: candidate.latitude,
      longitude: candidate.longitude,
    });
  }
  return { fsqPlaceId, name, formattedAddress, coordinates };
}

export function mapFoursquarePolicyFields(
  fields: Readonly<Record<string, unknown>>,
): FoursquarePlaceFields | undefined {
  const fsqPlaceId = stringArray(fields.fsqPlaceId);
  const name = stringArray(fields.name);
  const formattedAddress = stringArray(fields.formattedAddress);
  const coordinates = pointArray(fields.coordinates);
  if (
    !fsqPlaceId ||
    !name ||
    !formattedAddress ||
    !coordinates ||
    fsqPlaceId.length !== name.length ||
    fsqPlaceId.length !== formattedAddress.length ||
    fsqPlaceId.length !== coordinates.length
  ) {
    return undefined;
  }
  return { fsqPlaceId, name, formattedAddress, coordinates };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringArray(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every(nonEmptyString)
    ? value
    : undefined;
}

function pointArray(
  value: unknown,
):
  | readonly { readonly latitude: number; readonly longitude: number }[]
  | undefined {
  if (!Array.isArray(value)) return undefined;
  const points = value.map((candidate) => {
    const point = asRecord(candidate);
    return isLatitude(point?.latitude) && isLongitude(point?.longitude)
      ? { latitude: point.latitude, longitude: point.longitude }
      : undefined;
  });
  return points.every(
    (
      point,
    ): point is { readonly latitude: number; readonly longitude: number } =>
      point !== undefined,
  )
    ? points
    : undefined;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
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
