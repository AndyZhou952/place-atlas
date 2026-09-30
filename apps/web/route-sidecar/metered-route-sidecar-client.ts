import {
  GOOGLE_ROUTE_SIDECAR_PROVIDER_ID,
  isRouteSidecarGeocodeRequest,
  isRouteSidecarWalkingMatrixRequest,
  isRouteSidecarTransitRequest,
  type GoogleRouteSidecarPort,
  type RouteSidecarFailure,
  type RouteSidecarWalkingMatrixResult,
} from './route-sidecar-contract.ts';
import {
  noOpNearbyDiagnosticRecorder,
  type NearbyDiagnosticRecorder,
} from './nearby-diagnostic-recorder.ts';

const hardMonthlyLimit = 8_000;
const transitMonthlyLimit = 250;

type RouteSidecarSku =
  | 'geocoding.requests'
  | 'walking_matrix.elements'
  | 'transit_routes.requests';

export interface RouteSidecarUsagePort {
  reserve(reservation: {
    readonly providerId: typeof GOOGLE_ROUTE_SIDECAR_PROVIDER_ID;
    readonly sku: RouteSidecarSku;
    readonly units: number;
    readonly requests: 1;
    readonly costUsd: number;
    readonly hardRequestLimit: number;
    readonly hardUnitLimit: number;
    readonly hardCostLimitUsd: number;
  }): Promise<'reserved' | 'quota_exceeded' | 'cost_exceeded'>;
}

export interface MeteredRouteSidecarClientOptions {
  readonly service: GoogleRouteSidecarPort | undefined;
  readonly usage: RouteSidecarUsagePort;
  readonly diagnosticRecorder?: NearbyDiagnosticRecorder;
}

export function createMeteredRouteSidecarClient({
  service,
  usage,
  diagnosticRecorder = noOpNearbyDiagnosticRecorder,
}: MeteredRouteSidecarClientOptions): GoogleRouteSidecarPort {
  return {
    async geocode(request) {
      if (!service) {
        recordBindingMissing(
          diagnosticRecorder,
          'geocoding',
          'geocoding.requests',
        );
        return failure('not_configured');
      }
      if (!isRouteSidecarGeocodeRequest(request)) {
        return failure('invalid_request');
      }
      return reserveThenCall(
        usage,
        diagnosticRecorder,
        'geocoding',
        'geocoding.requests',
        1,
        () => service.geocode(request),
      );
    },
    async walkingMatrix(request): Promise<RouteSidecarWalkingMatrixResult> {
      if (!service) {
        recordBindingMissing(
          diagnosticRecorder,
          'walking_matrix',
          'walking_matrix.elements',
        );
        return failure('not_configured');
      }
      if (!isRouteSidecarWalkingMatrixRequest(request)) {
        return failure('invalid_request');
      }
      const units = request.destinations.length;
      return reserveThenCall(
        usage,
        diagnosticRecorder,
        'walking_matrix',
        'walking_matrix.elements',
        units,
        () => service.walkingMatrix(request),
      );
    },
    async transit(request) {
      if (!service) {
        recordBindingMissing(
          diagnosticRecorder,
          'transit',
          'transit_routes.requests',
        );
        return failure('not_configured');
      }
      if (!isRouteSidecarTransitRequest(request))
        return failure('invalid_request');
      return reserveThenCall(
        usage,
        diagnosticRecorder,
        'transit',
        'transit_routes.requests',
        1,
        () => service.transit(request),
      );
    },
  };
}

async function reserveThenCall<T>(
  usage: RouteSidecarUsagePort,
  diagnosticRecorder: NearbyDiagnosticRecorder,
  operation: 'geocoding' | 'walking_matrix' | 'transit',
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
      costUsd: sku === 'transit_routes.requests' ? 0.02 : 0,
      hardRequestLimit:
        sku === 'transit_routes.requests'
          ? transitMonthlyLimit
          : hardMonthlyLimit,
      hardUnitLimit:
        sku === 'transit_routes.requests'
          ? transitMonthlyLimit
          : hardMonthlyLimit,
      hardCostLimitUsd: sku === 'transit_routes.requests' ? 5 : 0,
    });
  } catch {
    recordQuotaExhausted(diagnosticRecorder, operation, sku);
    return failure('quota_exceeded');
  }
  if (reservation !== 'reserved') {
    recordQuotaExhausted(diagnosticRecorder, operation, sku);
    return failure('quota_exceeded');
  }
  recordReserved(diagnosticRecorder, operation, sku);
  try {
    return await invoke();
  } catch {
    return failure('dependency_failure');
  }
}

function recordBindingMissing(
  recorder: NearbyDiagnosticRecorder,
  operation: 'geocoding' | 'walking_matrix' | 'transit',
  sku: RouteSidecarSku,
): void {
  recorder.record({
    layer: 'owner_metering',
    operation,
    endpoint: 'route_sidecar_binding',
    sku,
    resultClass: 'binding_missing',
    quotaDecision: 'not_checked',
  });
}

function recordQuotaExhausted(
  recorder: NearbyDiagnosticRecorder,
  operation: 'geocoding' | 'walking_matrix' | 'transit',
  sku: RouteSidecarSku,
): void {
  recorder.record({
    layer: 'owner_metering',
    operation,
    endpoint: 'route_sidecar_binding',
    sku,
    resultClass: 'quota_exhausted',
    quotaDecision: 'rejected',
  });
}

function recordReserved(
  recorder: NearbyDiagnosticRecorder,
  operation: 'geocoding' | 'walking_matrix' | 'transit',
  sku: RouteSidecarSku,
): void {
  recorder.record({
    layer: 'owner_metering',
    operation,
    endpoint: 'route_sidecar_binding',
    sku,
    resultClass: 'reserved',
    quotaDecision: 'reserved',
  });
}

function failure(error: RouteSidecarFailure['error']): RouteSidecarFailure {
  return { ok: false, error };
}

export type RouteSidecarServiceBinding = Pick<
  GoogleRouteSidecarPort,
  'geocode' | 'walkingMatrix' | 'transit'
>;
