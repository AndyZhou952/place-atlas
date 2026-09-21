export interface GoogleRouteMatrixFields {
  readonly routeDurationSeconds: readonly (number | null)[];
  readonly routeDistanceMeters: readonly (number | null)[];
}

export function mapGoogleRouteMatrixResponse(
  payload: unknown,
  destinationCount: number,
): GoogleRouteMatrixFields | undefined {
  if (
    !Array.isArray(payload) ||
    !Number.isInteger(destinationCount) ||
    destinationCount < 1 ||
    payload.length !== destinationCount
  ) {
    return undefined;
  }
  const durations: (number | null | undefined)[] = Array.from({
    length: destinationCount,
  });
  const distances: (number | null | undefined)[] = Array.from({
    length: destinationCount,
  });

  for (const value of payload) {
    const element = asRecord(value);
    const status = asRecord(element?.status);
    if (
      !element ||
      element.originIndex !== 0 ||
      !isNonNegativeInteger(element.destinationIndex) ||
      element.destinationIndex >= destinationCount ||
      durations[element.destinationIndex] !== undefined ||
      !status ||
      typeof element.condition !== 'string'
    ) {
      return undefined;
    }

    const statusCode = status.code ?? 0;
    if (statusCode !== 0 || element.condition === 'ROUTE_NOT_FOUND') {
      durations[element.destinationIndex] = null;
      distances[element.destinationIndex] = null;
      continue;
    }
    if (
      element.condition !== 'ROUTE_EXISTS' ||
      typeof element.duration !== 'string' ||
      !/^(?:0|[1-9]\d*)(?:\.\d+)?s$/u.test(element.duration) ||
      !isNonNegativeNumber(element.distanceMeters)
    ) {
      return undefined;
    }
    const durationSeconds = Number(element.duration.slice(0, -1));
    if (!Number.isFinite(durationSeconds)) return undefined;
    durations[element.destinationIndex] = Math.ceil(durationSeconds);
    distances[element.destinationIndex] = element.distanceMeters;
  }

  if (
    durations.some((value) => value === undefined) ||
    distances.some((value) => value === undefined)
  ) {
    return undefined;
  }
  return {
    routeDurationSeconds: durations as (number | null)[],
    routeDistanceMeters: distances as (number | null)[],
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}
