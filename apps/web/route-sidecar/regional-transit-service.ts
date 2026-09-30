import {
  NAVITIME_TRANSIT_PROVIDER_ID,
  type RouteSidecarTransitRequest,
  type RouteSidecarTransitResult,
} from './route-sidecar-contract.ts';
import {
  lookupNavitimeDirectTrain,
  NAVITIME_TRANSIT_ENDPOINT,
} from './navitime-transit-transport.ts';
import { isJapanTransitArea } from './transit-coverage.ts';

const navitimeAttribution = {
  label: 'NAVITIME',
  url: 'https://www.navitime.co.jp/',
} as const;

export function createRegionalTransitService(input: {
  readonly googleTransit: (
    request: RouteSidecarTransitRequest,
  ) => Promise<RouteSidecarTransitResult>;
  readonly navitimeApiKey: string | undefined;
  readonly now: () => Date;
  readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
}) {
  return async (
    request: RouteSidecarTransitRequest,
  ): Promise<RouteSidecarTransitResult> => {
    if (
      !isJapanTransitArea(request.origin) &&
      !isJapanTransitArea(request.destination)
    )
      return input.googleTransit(request);
    const result = await lookupNavitimeDirectTrain(request, {
      apiKey: input.navitimeApiKey,
      now: input.now,
      fetch: input.fetch,
    });
    if (result.status !== 'ok')
      return {
        ok: false,
        error:
          result.status === 'unavailable'
            ? 'dependency_failure'
            : result.status,
      };
    return {
      ok: true,
      evidence: {
        directRoute: result.directRoute,
        checkedAt: result.checkedAt,
        attribution: navitimeAttribution,
        source: {
          providerId: NAVITIME_TRANSIT_PROVIDER_ID,
          endpoint: NAVITIME_TRANSIT_ENDPOINT,
        },
      },
    };
  };
}
