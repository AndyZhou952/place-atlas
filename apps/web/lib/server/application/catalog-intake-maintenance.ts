import type { CatalogIntakeStatePort } from '@/product/application/catalog-intake/catalog-intake-coordinator';

import { D1CatalogIntakeState } from './d1-catalog-intake-state.ts';

export function createCatalogIntakeCleanup(
  state: Pick<CatalogIntakeStatePort, 'cleanup'>,
) {
  return (now: Date) => state.cleanup(now);
}

export function runD1CatalogIntakeCleanup(database: D1Database, now: Date) {
  return createCatalogIntakeCleanup(new D1CatalogIntakeState(database))(now);
}
