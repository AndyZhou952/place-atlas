import { env } from 'cloudflare:workers';

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
  return {
    googlePlacesApiKey: env.GOOGLE_PLACES_API_KEY,
    providerModes: {
      googlePlaces: env.CATALOG_INTAKE_GOOGLE_PLACES_MODE,
      durableGeocoder: env.CATALOG_INTAKE_DURABLE_GEOCODER_MODE,
      researchRelay: env.CATALOG_INTAKE_RESEARCH_RELAY_MODE,
    },
  };
}
