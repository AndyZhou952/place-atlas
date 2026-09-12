import type { AtlasItem } from './atlas-item.ts';
import type { CatalogStateSnapshot } from './catalog-state.ts';
import { isEffectivelyVisited } from '../assessments/effective-visited.ts';

export function projectCatalog(
  snapshot: CatalogStateSnapshot,
  seedItems: readonly AtlasItem[],
): readonly AtlasItem[] {
  const dynamicItems = snapshot.dynamicPayloads.flatMap((payload) => {
    try {
      const candidate: unknown = JSON.parse(payload);
      return isAtlasItem(candidate) ? [candidate] : [];
    } catch {
      return [];
    }
  });
  const itemsById = new Map(
    [...seedItems, ...dynamicItems].map((item) => [item.id, item]),
  );

  for (const itemId of snapshot.tombstoneIds) itemsById.delete(itemId);

  for (const override of snapshot.overrides) {
    const item = itemsById.get(override.itemId);
    if (!item) continue;
    itemsById.set(override.itemId, {
      ...item,
      title: override.title,
      description: override.description,
      personalState: override.personalState,
      updatedAt: override.updatedAt,
    });
  }

  const assessmentsByItem = new Map(
    snapshot.assessments.map((assessment) => [assessment.itemId, assessment]),
  );
  const visitCountsByItem = new Map(
    snapshot.visitCounts.map((visitCount) => [
      visitCount.itemId,
      visitCount.count,
    ]),
  );

  for (const [id, item] of itemsById) {
    const assessment = assessmentsByItem.get(id);
    itemsById.set(id, {
      ...item,
      personalRating: assessment?.overallRating,
      isFavorite: assessment?.isFavorite ?? false,
      hasVisited: isEffectivelyVisited(
        assessment?.manualVisited,
        visitCountsByItem.get(id) ?? 0,
      ),
    });
  }

  return [...itemsById.values()];
}

export function isAtlasItem(value: unknown): value is AtlasItem {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    isAtlasItemKind(value.kind) &&
    typeof value.title === 'string' &&
    (value.alternateTitle === undefined ||
      typeof value.alternateTitle === 'string') &&
    typeof value.area === 'string' &&
    typeof value.address === 'string' &&
    typeof value.description === 'string' &&
    typeof value.latitude === 'number' &&
    Number.isFinite(value.latitude) &&
    value.latitude >= -90 &&
    value.latitude <= 90 &&
    typeof value.longitude === 'number' &&
    Number.isFinite(value.longitude) &&
    value.longitude >= -180 &&
    value.longitude <= 180 &&
    (value.verificationStatus === 'verified' ||
      value.verificationStatus === 'needs_review') &&
    typeof value.verifiedAt === 'string' &&
    (value.officialUrl === undefined ||
      typeof value.officialUrl === 'string') &&
    (value.tabelog === undefined || isTabelog(value.tabelog)) &&
    isReservation(value.reservation) &&
    (value.event === undefined || isEventSchedule(value.event)) &&
    isPersonalState(value.personalState) &&
    (value.personalRating === undefined ||
      (typeof value.personalRating === 'number' &&
        Number.isFinite(value.personalRating))) &&
    (value.isFavorite === undefined || typeof value.isFavorite === 'boolean') &&
    (value.hasVisited === undefined || typeof value.hasVisited === 'boolean') &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === 'string') &&
    Array.isArray(value.sources) &&
    value.sources.every(isSourceLink) &&
    (value.updatedAt === undefined || typeof value.updatedAt === 'string')
  );
}

function isReservation(value: unknown): boolean {
  return (
    isRecord(value) &&
    (value.mode === 'walk-in' ||
      value.mode === 'same-day' ||
      value.mode === 'advance' ||
      value.mode === 'ticketed' ||
      value.mode === 'unavailable' ||
      value.mode === 'unknown') &&
    typeof value.label === 'string' &&
    (value.channel === undefined || typeof value.channel === 'string') &&
    (value.url === undefined || typeof value.url === 'string') &&
    (value.advanceDays === undefined ||
      (typeof value.advanceDays === 'number' &&
        Number.isFinite(value.advanceDays))) &&
    (value.bookingWindowLabel === undefined ||
      typeof value.bookingWindowLabel === 'string') &&
    (value.releaseNote === undefined ||
      typeof value.releaseNote === 'string') &&
    typeof value.checkedAt === 'string'
  );
}

function isTabelog(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.score === 'number' &&
    Number.isFinite(value.score) &&
    (value.reviewCount === undefined ||
      (typeof value.reviewCount === 'number' &&
        Number.isFinite(value.reviewCount))) &&
    typeof value.url === 'string' &&
    typeof value.checkedAt === 'string'
  );
}

function isEventSchedule(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.startDate === 'string' &&
    typeof value.endDate === 'string' &&
    typeof value.displayDate === 'string'
  );
}

function isSourceLink(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.label === 'string' &&
    typeof value.url === 'string' &&
    (value.role === 'official' ||
      value.role === 'tabelog' ||
      value.role === 'reservation' ||
      value.role === 'discovery')
  );
}

function isAtlasItemKind(value: unknown): boolean {
  return value === 'food' || value === 'event' || value === 'architecture';
}

function isPersonalState(value: unknown): boolean {
  return (
    value === 'candidate' ||
    value === 'saved' ||
    value === 'planned' ||
    value === 'visited'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
