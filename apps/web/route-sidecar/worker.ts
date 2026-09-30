import { WorkerEntrypoint } from 'cloudflare:workers';

import {
  type RouteSidecarGeocodeRequest,
  type RouteSidecarGeocodeResult,
  type RouteSidecarWalkingMatrixRequest,
  type RouteSidecarWalkingMatrixResult,
  type RouteSidecarTransitRequest,
  type RouteSidecarTransitResult,
} from './route-sidecar-contract.ts';
import { createGoogleRouteSidecarService } from './route-sidecar-service.ts';
import { createOperationalNearbyDiagnosticRecorder } from './nearby-diagnostic-recorder.ts';

// The raw secret is deliberately absent from Wrangler config. Keep its runtime
// surface narrow here instead of committing a path-sensitive generated Env.
type RouteSidecarEnv = Readonly<
  Record<'GOOGLE_MAPS_API_KEY', string | undefined>
>;

export default class RouteSidecarWorker extends WorkerEntrypoint<RouteSidecarEnv> {
  fetch(): Response {
    return new Response(null, { status: 404 });
  }

  geocode(
    request: RouteSidecarGeocodeRequest,
  ): Promise<RouteSidecarGeocodeResult> {
    return this.#service().geocode(request);
  }

  walkingMatrix(
    request: RouteSidecarWalkingMatrixRequest,
  ): Promise<RouteSidecarWalkingMatrixResult> {
    return this.#service().walkingMatrix(request);
  }

  transit(
    request: RouteSidecarTransitRequest,
  ): Promise<RouteSidecarTransitResult> {
    return this.#service().transit(request);
  }

  #service() {
    return createGoogleRouteSidecarService({
      apiKey: this.env.GOOGLE_MAPS_API_KEY,
      clock: () => new Date(),
      fetch: (url, init) => fetch(url, init),
      diagnosticRecorder: createOperationalNearbyDiagnosticRecorder(),
    });
  }
}
