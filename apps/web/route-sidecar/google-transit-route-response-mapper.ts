const railVehicles = new Set([
  'COMMUTER_TRAIN',
  'HEAVY_RAIL',
  'HIGH_SPEED_TRAIN',
  'LONG_DISTANCE_TRAIN',
  'METRO_RAIL',
  'MONORAIL',
  'RAIL',
  'SUBWAY',
  'TRAM',
]);

interface DirectRoute {
  readonly durationSeconds: number;
  readonly lineIdentity: string;
}

export function mapGoogleTransitRouteResponse(
  raw: unknown,
): { readonly directRoute: DirectRoute | null } | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.routes === undefined && Object.keys(raw).length === 0) return { directRoute: null };
  if (!Array.isArray(raw.routes) || raw.routes.length > 4) return undefined;
  const candidates: DirectRoute[] = [];
  for (const route of raw.routes) {
    if (!isRecord(route) || !Array.isArray(route.legs) || route.legs.length !== 1) return undefined;
    const leg = route.legs[0];
    if (!isRecord(leg) || !Array.isArray(leg.steps) || !leg.steps.length) return undefined;
    const seconds = parseSeconds(route.duration);
    if (seconds === undefined) return undefined;
    const transitSteps = [];
    for (const step of leg.steps) {
      if (!isRecord(step) || typeof step.travelMode !== 'string') return undefined;
      if (step.travelMode === 'TRANSIT') transitSteps.push(step);
      else if (step.travelMode !== 'WALK') return undefined;
    }
    if (transitSteps.length !== 1) continue;
    const line = isRecord(transitSteps[0].transitDetails)
      ? transitSteps[0].transitDetails.transitLine
      : undefined;
    const vehicle = isRecord(line) ? line.vehicle : undefined;
    const type = isRecord(vehicle) ? vehicle.type : undefined;
    if (typeof type !== 'string') return undefined;
    if (!railVehicles.has(type)) continue;
    const name = isRecord(line) ? line.name : undefined;
    candidates.push({
      durationSeconds: seconds,
      lineIdentity: typeof name === 'string' && name.trim() ? name.trim() : type,
    });
  }
  candidates.sort((a, b) => a.durationSeconds - b.durationSeconds);
  return { directRoute: candidates[0] ?? null };
}

function parseSeconds(value: unknown): number | undefined {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?s$/u.test(value)) return undefined;
  const seconds = Number(value.slice(0, -1));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
