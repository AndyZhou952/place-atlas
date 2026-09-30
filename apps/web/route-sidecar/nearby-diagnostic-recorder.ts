export type NearbyDiagnosticEvent =
  | {
      readonly layer: 'sidecar_transport';
      readonly operation: 'geocoding' | 'walking_matrix' | 'transit';
      readonly endpoint: 'geocoding' | 'walking_matrix' | 'transit';
      readonly resultClass:
        | 'not_configured'
        | 'credential_rejected'
        | 'transport_unavailable'
        | 'upstream_unavailable'
        | 'malformed_response'
        | 'success'
        | 'not_found';
      readonly httpClass?: '2xx' | '3xx' | '4xx' | '5xx';
    }
  | {
      readonly layer: 'owner_metering';
      readonly operation: 'geocoding' | 'walking_matrix' | 'transit';
      readonly endpoint: 'route_sidecar_binding';
      readonly sku:
        | 'geocoding.requests'
        | 'walking_matrix.elements'
        | 'transit_routes.requests';
      readonly resultClass:
        | 'binding_missing'
        | 'quota_exhausted'
        | 'unsupported_region'
        | 'reserved';
      readonly quotaDecision: 'not_checked' | 'rejected' | 'reserved';
    };

export interface NearbyDiagnosticRecorder {
  record(event: NearbyDiagnosticEvent): void;
}

export function createAllowlistedNearbyDiagnosticRecorder(
  write: (event: NearbyDiagnosticEvent) => void,
): NearbyDiagnosticRecorder {
  return {
    record(event) {
      try {
        write(projectAllowlistedEvent(event));
      } catch {
        // Diagnostics must never alter the product outcome.
      }
    },
  };
}

export const noOpNearbyDiagnosticRecorder: NearbyDiagnosticRecorder = {
  record() {},
};

export function createOperationalNearbyDiagnosticRecorder(): NearbyDiagnosticRecorder {
  return createAllowlistedNearbyDiagnosticRecorder((event) => {
    globalThis.console.info('nearby_diagnostic', event);
  });
}

function projectAllowlistedEvent(
  event: NearbyDiagnosticEvent,
): NearbyDiagnosticEvent {
  if (event.layer === 'owner_metering') {
    return {
      layer: event.layer,
      operation: event.operation,
      endpoint: event.endpoint,
      sku: event.sku,
      resultClass: event.resultClass,
      quotaDecision: event.quotaDecision,
    };
  }
  return {
    layer: event.layer,
    operation: event.operation,
    endpoint: event.endpoint,
    resultClass: event.resultClass,
    ...(event.httpClass === undefined ? {} : { httpClass: event.httpClass }),
  };
}
