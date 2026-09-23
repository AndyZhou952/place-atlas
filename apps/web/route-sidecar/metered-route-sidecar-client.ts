import {
  GOOGLE_ROUTE_SIDECAR_PROVIDER_ID,
  isRouteSidecarGeocodeRequest,
  isRouteSidecarWalkingMatrixRequest,
  type GoogleRouteSidecarPort,
  type RouteSidecarFailure,
  type RouteSidecarWalkingMatrixResult,
} from './route-sidecar-contract.ts';

const hardMonthlyLimit = 8_000;

type RouteSidecarSku = 'geocoding.requests' | 'walking_matrix.elements';

export interface RouteSidecarUsagePort {
  reserve(reservation: {
    readonly providerId: typeof GOOGLE_ROUTE_SIDECAR_PROVIDER_ID;
    readonly sku: RouteSidecarSku;
    readonly units: number;
    readonly requests: 1;
    readonly costUsd: 0;
    readonly hardRequestLimit: typeof hardMonthlyLimit;
    readonly hardUnitLimit: typeof hardMonthlyLimit;
    readonly hardCostLimitUsd: 0;
  }): Promise<'reserved' | 'quota_exceeded' | 'cost_exceeded'>;
}

export interface MeteredRouteSidecarClientOptions {
  readonly service: GoogleRouteSidecarPort | undefined;
  readonly usage: RouteSidecarUsagePort;
}

export function createMeteredRouteSidecarClient({
  service,
  usage,
}: MeteredRouteSidecarClientOptions): GoogleRouteSidecarPort {
  return {
    async geocode(request) {
      if (!service) return failure('not_configured');
      if (!isRouteSidecarGeocodeRequest(request)) {
        return failure('invalid_request');
      }
      return reserveThenCall(usage, 'geocoding.requests', 1, () =>
        service.geocode(request),
      );
    },
    async walkingMatrix(request): Promise<RouteSidecarWalkingMatrixResult> {
      if (!service) return failure('not_configured');
      if (!isRouteSidecarWalkingMatrixRequest(request)) {
        return failure('invalid_request');
      }
      const units = request.destinations.length;
      return reserveThenCall(usage, 'walking_matrix.elements', units, () =>
        service.walkingMatrix(request),
      );
    },
  };
}

async function reserveThenCall<T>(
  usage: RouteSidecarUsagePort,
  sku: RouteSidecarSku,
  units: number,
  invoke: () => Promise<T>,
): Promise<T | RouteSidecarFailure> {
  let reservation: Awaited<ReturnType<RouteSidecarUsagePort['reserve']>>;
  try {
    reservation = await usage.reserve({
      providerId: GOOGLE_ROUTE_SIDECAR_PROVIDER_ID,
      sku,
      units,
      requests: 1,
      costUsd: 0,
      hardRequestLimit: hardMonthlyLimit,
      hardUnitLimit: hardMonthlyLimit,
      hardCostLimitUsd: 0,
    });
  } catch {
    return failure('quota_exceeded');
  }
  if (reservation !== 'reserved') return failure('quota_exceeded');
  try {
    return await invoke();
  } catch {
    return failure('dependency_failure');
  }
}

function failure(error: RouteSidecarFailure['error']): RouteSidecarFailure {
  return { ok: false, error };
}

export type RouteSidecarServiceBinding = Pick<
  GoogleRouteSidecarPort,
  'geocode' | 'walkingMatrix'
>;
