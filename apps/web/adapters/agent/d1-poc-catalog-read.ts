import type { AtlasItem } from '../../product/application/catalog/atlas-item.ts';
import type { CatalogRead } from '../../product/application/catalog/catalog-read.ts';
import { isAtlasItem } from '../../product/application/catalog/catalog-projection.ts';

interface CatalogItemRow {
  readonly id: string;
  readonly kind: string;
  readonly verification_status: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly payload_json: string;
}

export function createD1PocCatalogRead(database: D1Database): CatalogRead {
  return {
    async list(profile) {
      const { results } = await database
        .prepare(
          `SELECT id, kind, verification_status, latitude, longitude, payload_json
           FROM agent_catalog_items
           ORDER BY id ASC`,
        )
        .all<CatalogItemRow>();

      const items = results.flatMap(parseCatalogItemRow);
      return profile === 'verified_catalog'
        ? items.filter((item) => item.verificationStatus === 'verified')
        : items;
    },
    async get(id) {
      const row = await database
        .prepare(
          `SELECT id, kind, verification_status, latitude, longitude, payload_json
           FROM agent_catalog_items
           WHERE id = ?`,
        )
        .bind(id)
        .first<CatalogItemRow>();

      return row ? parseCatalogItemRow(row)[0] : undefined;
    },
  };
}

function parseCatalogItemRow(row: CatalogItemRow): readonly AtlasItem[] {
  try {
    const candidate: unknown = JSON.parse(row.payload_json);
    return isAtlasItem(candidate) && hasConsistentIndexedFacts(row, candidate)
      ? [candidate]
      : [];
  } catch {
    return [];
  }
}

function hasConsistentIndexedFacts(
  row: CatalogItemRow,
  candidate: AtlasItem,
): boolean {
  return (
    candidate.id === row.id &&
    candidate.kind === row.kind &&
    candidate.verificationStatus === row.verification_status &&
    candidate.latitude === row.latitude &&
    candidate.longitude === row.longitude
  );
}
