import { env } from 'cloudflare:workers';

import { projectOwnerPocCatalogIntakeRuntime } from '../lib/server/application/catalog-intake-provider-mode-manifest';
import type { RouteSidecarServiceBinding } from '../route-sidecar/metered-route-sidecar-client';

export function getD1(): D1Database {
  if (!env.DB) {
    throw new Error('Cloudflare D1 binding `DB` is unavailable.');
  }

  return env.DB;
}

export function getMediaBucket(): R2Bucket {
  const media = env.MEDIA;
  if (!media) {
    throw new Error('Cloudflare R2 binding `MEDIA` is unavailable.');
  }

  return media;
}

export function getAtlasDeploymentEnvironment(): string | undefined {
  return env.ATLAS_DEPLOYMENT_ENV;
}

export function getRouteSidecarServiceBinding():
  | RouteSidecarServiceBinding
  | undefined {
  return env.ROUTE_SIDECAR;
}

export function getOwnerPocCatalogIntakeRuntime() {
  return projectOwnerPocCatalogIntakeRuntime(env);
}
