export interface GoogleTransitFields {
  readonly transitLegs: {
    readonly durationSeconds: number;
    readonly boardingCount: number;
    readonly lineIdentities: readonly string[];
    readonly transferCount: number;
  };
}

export function mapGoogleTransitResponse(
  payload: unknown,
): GoogleTransitFields | undefined {
  const record = asRecord(payload);
  if (!record || !Array.isArray(record.routes) || record.routes.length === 0) {
    return undefined;
  }
  const route = asRecord(record.routes[0]);
  if (!route || !Array.isArray(route.legs) || route.legs.length === 0) {
    return undefined;
  }

  const durationSeconds = parseDuration(route.duration);
  if (durationSeconds === undefined) return undefined;
  const lineIdentities: string[] = [];
  for (const rawLeg of route.legs) {
    const leg = asRecord(rawLeg);
    if (!leg || !Array.isArray(leg.steps) || leg.steps.length === 0) {
      return undefined;
    }
    for (const rawStep of leg.steps) {
      const step = asRecord(rawStep);
      if (
        !step ||
        (step.travelMode !== 'WALK' && step.travelMode !== 'TRANSIT')
      ) {
        return undefined;
      }
      if (step.travelMode === 'TRANSIT') {
        const identity = transitLineIdentity(step);
        if (!identity) return undefined;
        lineIdentities.push(identity);
      }
    }
  }
  if (lineIdentities.length === 0) return undefined;

  return {
    transitLegs: {
      durationSeconds,
      boardingCount: lineIdentities.length,
      lineIdentities,
      transferCount: Math.max(0, lineIdentities.length - 1),
    },
  };
}

function transitLineIdentity(
  step: Record<string, unknown>,
): string | undefined {
  const transitDetails = asRecord(step.transitDetails);
  const transitLine = asRecord(transitDetails?.transitLine);
  if (!transitLine) return undefined;
  const name = readNonBlank(transitLine.name);
  const nameShortCode = readNonBlank(transitLine.nameShortCode);
  if (!name && !nameShortCode) return undefined;

  const agencies = Array.isArray(transitLine.agencies)
    ? transitLine.agencies.flatMap((candidate) => {
        const agency = asRecord(candidate);
        const agencyName = readNonBlank(agency?.name);
        return agencyName ? [agencyName] : [];
      })
    : [];
  return [...agencies, name, nameShortCode].filter(Boolean).join('|');
}

function parseDuration(value: unknown): number | undefined {
  if (
    typeof value !== 'string' ||
    !/^(?:0|[1-9]\d*)(?:\.\d+)?s$/u.test(value)
  ) {
    return undefined;
  }
  const seconds = Number(value.slice(0, -1));
  return Number.isFinite(seconds) ? Math.ceil(seconds) : undefined;
}

function readNonBlank(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
