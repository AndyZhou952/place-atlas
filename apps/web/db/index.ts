import { env } from 'cloudflare:workers';

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
