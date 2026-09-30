import {
  GOOGLE_ROUTE_SIDECAR_PROVIDER_ID,
  NAVITIME_TRANSIT_PROVIDER_ID,
  isRouteSidecarGeocodeRequest,
  isRouteSidecarWalkingMatrixRequest,
  isRouteSidecarTransitRequest,
  type GoogleRouteSidecarPort,
  type RouteSidecarFailure,
  type RouteSidecarWalkingMatrixResult,
} from './route-sidecar-contract.ts';
import { isJapanTransitArea } from './transit-coverage.ts';
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
    readonly providerId:
      | typeof GOOGLE_ROUTE_SIDECAR_PROVIDER_ID
      | typeof NAVITIME_TRANSIT_PROVIDER_ID;
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
  readonly japanTransitEnabled?: boolean;
}

export function createMeteredRouteSidecarClient({
  service,
  usage,
  diagnosticRecorder = noOpNearbyDiagnosticRecorder,
  japanTransitEnabled = false,
}: MeteredRouteSidecarClientOptions): GoogleRouteSidecarPort {
  let japanReadiness: Promise<boolean> | undefined;
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
      if (!isRouteSidecarTransitRequest(request))
        return failure('invalid_request');
      const japanTransit =
        isJapanTransitArea(request.origin) ||
        isJapanTransitArea(request.destination);
      if (japanTransit && !japanTransitEnabled) {
        diagnosticRecorder.record({
          layer: 'owner_metering',
          operation: 'transit',
          endpoint: 'route_sidecar_binding',
          sku: 'transit_routes.requests',
          resultClass: 'unsupported_region',
          quotaDecision: 'not_checked',
        });
        return failure('unsupported_region');
      }
      if (!service) {
        recordBindingMissing(
          diagnosticRecorder,
          'transit',
          'transit_routes.requests',
        );
        return failure('not_configured');
      }
      if (japanTransit) {
        japanReadiness ??= Promise.resolve().then(
          () => service.japanTransitReady?.() ?? false,
        );
        let ready = false;
        try {
          ready = await japanReadiness;
        } catch {
          ready = false;
        }
        if (!ready) return failure('not_configured');
      }
      return reserveThenCall(
        usage,
        diagnosticRecorder,
        'transit',
        'transit_routes.requests',
        1,
        () => service.transit(request),
        japanTransit
          ? NAVITIME_TRANSIT_PROVIDER_ID
          : GOOGLE_ROUTE_SIDECAR_PROVIDER_ID,
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
  providerId:
    | typeof GOOGLE_ROUTE_SIDECAR_PROVIDER_ID
    | typeof NAVITIME_TRANSIT_PROVIDER_ID = GOOGLE_ROUTE_SIDECAR_PROVIDER_ID,
): Promise<T | RouteSidecarFailure> {
  let reservation: Awaited<ReturnType<RouteSidecarUsagePort['reserve']>>;
  try {
    reservation = await usage.reserve({
      providerId,
      sku,
      units,
      requests: 1,
      costUsd:
        sku === 'transit_routes.requests' &&
        providerId === GOOGLE_ROUTE_SIDECAR_PROVIDER_ID
          ? 0.02
          : 0,
      hardRequestLimit:
        sku === 'transit_routes.requests'
          ? transitMonthlyLimit
          : hardMonthlyLimit,
      hardUnitLimit:
        sku === 'transit_routes.requests'
          ? transitMonthlyLimit
          : hardMonthlyLimit,
      hardCostLimitUsd:
        sku === 'transit_routes.requests' &&
        providerId === GOOGLE_ROUTE_SIDECAR_PROVIDER_ID
          ? 5
          : 0,
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
  'geocode' | 'walkingMatrix' | 'transit' | 'japanTransitReady'
>;
