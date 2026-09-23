import type { AtlasItem } from '../../product/application/catalog/atlas-item.ts';
import type { CatalogRead } from '../../product/application/catalog/catalog-read.ts';
import { isAtlasItem } from '../../product/application/catalog/catalog-projection.ts';
import type { NearbyPersonalFactsRead } from '../../product/application/decision/agent-nearby-operation.ts';

interface OwnerCatalogRow {
  readonly id: string;
  readonly payload_json: string;
  readonly verification_status: string;
  readonly override_title: string | null;
  readonly override_description: string | null;
  readonly override_personal_state: string | null;
  readonly override_updated_at: string | null;
  readonly overall_rating: number | null;
  readonly is_favorite: number | null;
  readonly manual_visited: number | null;
  readonly visit_count: number;
}

interface PersonalFactsRow {
  readonly manual_visited: number;
  readonly personal_rating: number | null;
  readonly visit_count: number;
  readonly latest_visit_at: string | null;
}

const selectCatalog = `
  SELECT items.id,
         items.payload_json,
         items.verification_status,
         overrides.title AS override_title,
         overrides.description AS override_description,
         overrides.personal_state AS override_personal_state,
         overrides.updated_at AS override_updated_at,
         assessments.overall_rating,
         assessments.is_favorite,
         assessments.has_visited AS manual_visited,
         (SELECT COUNT(*) FROM visits WHERE visits.item_id = items.id)
           AS visit_count
  FROM atlas_items AS items
  LEFT JOIN atlas_item_overrides AS overrides
    ON overrides.item_id = items.id
  LEFT JOIN place_assessments AS assessments
    ON assessments.item_id = items.id
  LEFT JOIN atlas_item_tombstones AS tombstones
    ON tombstones.item_id = items.id
  WHERE tombstones.item_id IS NULL`;

export function createD1OwnerPocCatalogRead(database: D1Database): CatalogRead {
  return {
    async list(profile) {
      const { results } = await database
        .prepare(
          `${selectCatalog} ORDER BY items.created_at DESC, items.id ASC`,
        )
        .all<OwnerCatalogRow>();
      const items = results.flatMap(projectRow);
      return profile === 'verified_catalog'
        ? items.filter((item) => item.verificationStatus === 'verified')
        : items;
    },
    async get(id) {
      const { results } = await database
        .prepare(`${selectCatalog} AND items.id = ?`)
        .bind(id)
        .all<OwnerCatalogRow>();
      return results.flatMap(projectRow)[0];
    },
  };
}

export function createD1OwnerPocPersonalFactsRead(
  database: D1Database,
): NearbyPersonalFactsRead {
  return {
    async read(itemId) {
      const row = await database
        .prepare(
          `SELECT
             COALESCE((
               SELECT has_visited FROM place_assessments WHERE item_id = ?
             ), 0) AS manual_visited,
             (
               SELECT overall_rating FROM place_assessments WHERE item_id = ?
             ) AS personal_rating,
             (
               SELECT COUNT(*) FROM visits WHERE item_id = ?
             ) AS visit_count,
             (
               SELECT MAX(visited_at) FROM visits WHERE item_id = ?
             ) AS latest_visit_at`,
        )
        .bind(itemId, itemId, itemId, itemId)
        .first<PersonalFactsRow>();
      if (
        !row ||
        (row.manual_visited !== 0 && row.manual_visited !== 1) ||
        !Number.isSafeInteger(row.visit_count) ||
        row.visit_count < 0 ||
        (row.personal_rating !== null &&
          !Number.isFinite(row.personal_rating)) ||
        (row.latest_visit_at !== null &&
          typeof row.latest_visit_at !== 'string')
      ) {
        throw new Error('Owner PoC personal facts are invalid.');
      }
      return {
        manualVisited: row.manual_visited === 1,
        visitCount: row.visit_count,
        ...(row.latest_visit_at ? { latestVisitAt: row.latest_visit_at } : {}),
        ...(typeof row.personal_rating === 'number'
          ? { personalRating: row.personal_rating }
          : {}),
      };
    },
  };
}

function projectRow(row: OwnerCatalogRow): readonly AtlasItem[] {
  try {
    const payload: unknown = JSON.parse(row.payload_json);
    if (
      !isAtlasItem(payload) ||
      payload.id !== row.id ||
      payload.verificationStatus !== row.verification_status
    ) {
      return [];
    }
    const override = readOverride(row);
    const projected: AtlasItem = {
      ...payload,
      ...(override
        ? {
            title: override.title,
            description: override.description,
            personalState: override.personalState,
            updatedAt: override.updatedAt,
          }
        : {}),
      personalRating:
        typeof row.overall_rating === 'number' ? row.overall_rating : undefined,
      isFavorite: row.is_favorite === 1,
      hasVisited: row.manual_visited === 1 || row.visit_count > 0,
    };
    return isAtlasItem(projected) ? [projected] : [];
  } catch {
    return [];
  }
}

function readOverride(row: OwnerCatalogRow):
  | {
      readonly title: string;
      readonly description: string;
      readonly personalState: AtlasItem['personalState'];
      readonly updatedAt: string;
    }
  | undefined {
  if (
    typeof row.override_title !== 'string' ||
    typeof row.override_description !== 'string' ||
    !isPersonalState(row.override_personal_state) ||
    typeof row.override_updated_at !== 'string'
  ) {
    return undefined;
  }
  return {
    title: row.override_title,
    description: row.override_description,
    personalState: row.override_personal_state,
    updatedAt: row.override_updated_at,
  };
}

function isPersonalState(
  value: string | null,
): value is AtlasItem['personalState'] {
  return (
    value === 'candidate' ||
    value === 'saved' ||
    value === 'planned' ||
    value === 'visited'
  );
}
