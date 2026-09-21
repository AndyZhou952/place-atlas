import { env } from 'cloudflare:workers';

import type { RouteSidecarServiceBinding } from '../route-sidecar/metered-route-sidecar-client';

export function getD1(): D1Database {
  if (!env.DB) {
    throw new Error('Cloudflare D1 binding `DB` is unavailable.');
  }

  return env.DB;
}

export function getMediaBucket(): R2Bucket {
  const media = (env as unknown as { MEDIA?: R2Bucket }).MEDIA;
  if (!media) {
    throw new Error('Cloudflare R2 binding `MEDIA` is unavailable.');
  }

  return media;
}

export function getAtlasDeploymentEnvironment(): string | undefined {
  return (env as unknown as { ATLAS_DEPLOYMENT_ENV?: string })
    .ATLAS_DEPLOYMENT_ENV;
}

export function getRouteSidecarServiceBinding():
  | RouteSidecarServiceBinding
  | undefined {
  return (env as unknown as { ROUTE_SIDECAR?: RouteSidecarServiceBinding })
    .ROUTE_SIDECAR;
}
