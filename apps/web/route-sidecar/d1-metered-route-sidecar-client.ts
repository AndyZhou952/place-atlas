import { D1ProviderUsage } from '../adapters/agent/d1-provider-usage.ts';
import {
  createMeteredRouteSidecarClient,
  type RouteSidecarServiceBinding,
} from './metered-route-sidecar-client.ts';
import type { NearbyDiagnosticRecorder } from './nearby-diagnostic-recorder.ts';

export function createD1MeteredRouteSidecarClient(input: {
  readonly database: D1Database;
  readonly service: RouteSidecarServiceBinding | undefined;
  readonly clock: () => Date;
  readonly diagnosticRecorder?: NearbyDiagnosticRecorder;
}) {
  return createMeteredRouteSidecarClient({
    service: input.service,
    usage: new D1ProviderUsage(input.database, input.clock),
    diagnosticRecorder: input.diagnosticRecorder,
  });
}
