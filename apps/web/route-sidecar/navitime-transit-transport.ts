import { mapNavitimeTransitRouteResponse } from '../adapters/providers/navitime-transit-route-response-mapper.ts';
import {
  isRouteSidecarTransitRequest,
  type RouteSidecarTransitRequest,
} from './route-sidecar-contract.ts';
import { isJapanTransitArea } from './transit-coverage.ts';

export const NAVITIME_TRANSIT_ENDPOINT =
  'https://navitime-route-totalnavi.p.rapidapi.com/route_transit';

export type NavitimeTransitLookup =
  | {
      readonly status: 'ok';
      readonly directRoute: NonNullable<
        ReturnType<typeof mapNavitimeTransitRouteResponse>
      >['directRoute'];
      readonly checkedAt: string;
    }
  | {
      readonly status:
        | 'invalid_request'
        | 'unsupported_region'
        | 'not_configured'
        | 'unavailable';
    };

export async function lookupNavitimeDirectTrain(
  request: RouteSidecarTransitRequest,
  input: {
    readonly apiKey: string | undefined;
    readonly now: () => Date;
    readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
  },
): Promise<NavitimeTransitLookup> {
  if (!isRouteSidecarTransitRequest(request))
    return { status: 'invalid_request' };
  if (
    !isJapanTransitArea(request.origin) ||
    !isJapanTransitArea(request.destination)
  )
    return { status: 'unsupported_region' };
  if (!hasNavitimeTransitCredential(input.apiKey))
    return { status: 'not_configured' };
  const checkedAt = input.now();
  if (!Number.isFinite(checkedAt.getTime())) return { status: 'unavailable' };
  const params = new URLSearchParams({
    start: `${request.origin.latitude},${request.origin.longitude}`,
    goal: `${request.destination.latitude},${request.destination.longitude}`,
    start_time: japanLocalTime(checkedAt),
    train_data: 'average',
    bus_data: 'none',
    use_car: 'false',
    limit: '10',
  });
  let response: Response;
  try {
    response = await input.fetch(`${NAVITIME_TRANSIT_ENDPOINT}?${params}`, {
      method: 'GET',
      headers: {
        'x-rapidapi-key': input.apiKey,
        'x-rapidapi-host': new URL(NAVITIME_TRANSIT_ENDPOINT).hostname,
      },
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch {
    return { status: 'unavailable' };
  }
  if (response.status !== 200) return { status: 'unavailable' };
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    return { status: 'unavailable' };
  }
  const mapped = mapNavitimeTransitRouteResponse(raw);
  return mapped
    ? {
        status: 'ok',
        directRoute: mapped.directRoute,
        checkedAt: checkedAt.toISOString(),
      }
    : { status: 'unavailable' };
}

function japanLocalTime(date: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
    .format(date)
    .replace(' ', 'T');
}

export function hasNavitimeTransitCredential(
  value: string | undefined,
): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 512 &&
    !value.startsWith('<')
  );
}
