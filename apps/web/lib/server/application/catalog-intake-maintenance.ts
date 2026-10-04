import type { CatalogIntakeStatePort } from '@/product/application/catalog-intake/catalog-intake-coordinator';

import { D1CatalogIntakeState } from './d1-catalog-intake-state.ts';
import { D1NominatimPolicyState } from './d1-nominatim-policy-state.ts';

export function createCatalogIntakeCleanup(
  state: Pick<CatalogIntakeStatePort, 'cleanup'>,
) {
  return (now: Date) => state.cleanup(now);
}

export async function runD1CatalogIntakeCleanup(
  database: D1Database,
  now: Date,
) {
  const intake = await createCatalogIntakeCleanup(
    new D1CatalogIntakeState(database),
  )(now);
  const nominatimCacheRemoved = await new D1NominatimPolicyState(database, {
    now: () => now,
  }).cleanup(now);
  return { intake, nominatimCacheRemoved };
}
