import type {
  AtlasCatalogEntry,
  AtlasItem,
  AtlasReviewCandidate,
} from './atlas-item.ts';
import type { CatalogStateSnapshot } from './catalog-state.ts';
import { isEffectivelyVisited } from '../assessments/effective-visited.ts';
import { hasCanonicalCatalogIntakeWarningOrder } from '../catalog-intake/catalog-intake-warning-policy.ts';
import { validateEnrichedProfile } from '../catalog-intake/catalog-intake-coordinator.ts';

export function projectCatalog(
  snapshot: CatalogStateSnapshot,
  seedItems: readonly AtlasItem[],
): readonly AtlasCatalogEntry[] {
  const dynamicItems = snapshot.dynamicPayloads.flatMap((payload) => {
    try {
      const candidate: unknown = JSON.parse(payload);
      return isAtlasCatalogEntry(candidate) ? [candidate] : [];
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
    const catalogItem = isAtlasItem(item)
      ? projectIntakeCatalogFacts(item)
      : item;
    itemsById.set(id, {
      ...catalogItem,
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

function projectIntakeCatalogFacts(item: AtlasItem): AtlasItem {
  const evidence = item.intakeEvidence?.tabelog;
  if (item.tabelog || evidence?.status !== 'known') return item;

  return {
    ...item,
    tabelog: {
      score: evidence.score,
      ...(evidence.reviewCount === undefined
        ? {}
        : { reviewCount: evidence.reviewCount }),
      url: evidence.url,
      checkedAt:
        evidence.provenance === 'owner_asserted'
          ? evidence.assertedAt
          : evidence.observedAt,
    },
  };
}

export function isAtlasCatalogEntry(
  value: unknown,
): value is AtlasCatalogEntry {
  return isAtlasItem(value) || isAtlasReviewCandidate(value);
}

export function isAtlasReviewCandidate(
  value: unknown,
): value is AtlasReviewCandidate {
  if (
    !hasAllowedKeys(
      value,
      [
        'recordType',
        'id',
        'kind',
        'title',
        'area',
        'description',
        'verificationStatus',
        'personalState',
        'personalRating',
        'isFavorite',
        'hasVisited',
        'tags',
        'reviewEvidence',
        'updatedAt',
      ],
      [
        'recordType',
        'id',
        'kind',
        'title',
        'description',
        'verificationStatus',
        'personalState',
        'tags',
        'reviewEvidence',
        'updatedAt',
      ],
    ) ||
    value.recordType !== 'review_candidate' ||
    typeof value.id !== 'string' ||
    value.kind !== 'food' ||
    typeof value.title !== 'string' ||
    value.title.length === 0 ||
    (value.area !== undefined && typeof value.area !== 'string') ||
    typeof value.description !== 'string' ||
    value.verificationStatus !== 'needs_review' ||
    !isPersonalState(value.personalState) ||
    (value.personalRating !== undefined &&
      (typeof value.personalRating !== 'number' ||
        !Number.isFinite(value.personalRating))) ||
    (value.isFavorite !== undefined && typeof value.isFavorite !== 'boolean') ||
    (value.hasVisited !== undefined && typeof value.hasVisited !== 'boolean') ||
    !Array.isArray(value.tags) ||
    !value.tags.every((tag) => typeof tag === 'string') ||
    !isIsoTimestamp(value.updatedAt)
  ) {
    return false;
  }
  return isReviewEvidence(value.reviewEvidence);
}

function isReviewEvidence(value: unknown): boolean {
  if (
    !hasAllowedKeys(
      value,
      [
        'profile',
        'candidateIdentity',
        'ownerFields',
        'titleProposal',
        'addressProposal',
        'locationEvidence',
        'tabelog',
        'reservation',
        'unknownFields',
        'warnings',
      ],
      [
        'candidateIdentity',
        'ownerFields',
        'locationEvidence',
        'tabelog',
        'reservation',
        'unknownFields',
        'warnings',
      ],
    ) ||
    (value.profile !== undefined && !validateEnrichedProfile(value.profile)) ||
    !hasExactKeys(value.candidateIdentity, ['providerNamespace', 'placeId']) ||
    typeof value.candidateIdentity.providerNamespace !== 'string' ||
    typeof value.candidateIdentity.placeId !== 'string' ||
    !isReviewOwnerFields(value.ownerFields) ||
    (value.titleProposal !== undefined &&
      !isReviewTitleProposal(value.titleProposal)) ||
    (value.addressProposal !== undefined &&
      !isReviewAddressProposal(value.addressProposal)) ||
    !isReviewLocation(value.locationEvidence) ||
    !isReviewTabelog(value.tabelog) ||
    !isReviewReservation(value.reservation) ||
    !isOrderedUniqueValues(value.unknownFields, [
      'address',
      'coordinates',
      'tabelog',
      'reservation',
    ]) ||
    !hasCanonicalCatalogIntakeWarningOrder(value.warnings) ||
    !value.warnings.every(isReviewWarning)
  ) {
    return false;
  }
  return true;
}

function isReviewOwnerFields(value: unknown): boolean {
  return (
    hasAllowedKeys(
      value,
      [
        'title',
        'address',
        'area',
        'coordinates',
        'categories',
        'signatureDishes',
        'summary',
      ],
      [],
    ) &&
    (value.title === undefined || typeof value.title === 'string') &&
    (value.address === undefined || typeof value.address === 'string') &&
    (value.area === undefined || typeof value.area === 'string') &&
    (value.coordinates === undefined || isCoordinates(value.coordinates)) &&
    (value.categories === undefined || isReviewOwnerLabels(value.categories)) &&
    (value.signatureDishes === undefined ||
      isReviewOwnerLabels(value.signatureDishes)) &&
    (value.summary === undefined || typeof value.summary === 'string')
  );
}

function isReviewOwnerLabels(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 12 &&
    value.every(
      (entry) =>
        typeof entry === 'string' && entry.length > 0 && entry.length <= 100,
    )
  );
}

function isReviewTitleProposal(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.provenance === 'owner_query') {
    return (
      hasExactKeys(value, ['provenance', 'value']) &&
      typeof value.value === 'string'
    );
  }
  return (
    value.provenance === 'agent_observed' &&
    hasExactKeys(value, ['provenance', 'value', 'sourceUrl', 'observedAt']) &&
    typeof value.value === 'string' &&
    isCanonicalHttpsUrl(value.sourceUrl) &&
    isIsoTimestamp(value.observedAt)
  );
}

function isReviewAddressProposal(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.provenance === 'durable_geocoder_observed') {
    return (
      hasExactKeys(value, [
        'provenance',
        'value',
        'sourceUrl',
        'license',
        'checkedAt',
      ]) &&
      typeof value.value === 'string' &&
      isCanonicalHttpsUrl(value.sourceUrl) &&
      typeof value.license === 'string' &&
      isIsoTimestamp(value.checkedAt)
    );
  }
  return (
    value.provenance === 'agent_observed' &&
    hasExactKeys(value, ['provenance', 'value', 'sourceUrl', 'observedAt']) &&
    typeof value.value === 'string' &&
    isCanonicalHttpsUrl(value.sourceUrl) &&
    isIsoTimestamp(value.observedAt)
  );
}

function isReviewLocation(value: unknown): boolean {
  if (hasExactKeys(value, ['status'])) return value.status === 'unknown';
  if (!isRecord(value) || value.status !== 'known') return false;
  if (value.provenance === 'agent_observed') {
    return (
      hasExactKeys(value, [
        'status',
        'provenance',
        'normalizedAddress',
        'latitude',
        'longitude',
        'sourceUrl',
        'observedAt',
      ]) &&
      typeof value.normalizedAddress === 'string' &&
      isCoordinates(value) &&
      isCanonicalHttpsUrl(value.sourceUrl) &&
      isIsoTimestamp(value.observedAt)
    );
  }
  if (value.provenance === 'durable_geocoder_observed') {
    return (
      hasExactKeys(value, [
        'status',
        'provenance',
        'normalizedAddress',
        'latitude',
        'longitude',
        'provider',
        'sourceUrl',
        'license',
        'checkedAt',
      ]) &&
      typeof value.normalizedAddress === 'string' &&
      isCoordinates(value) &&
      typeof value.provider === 'string' &&
      isCanonicalHttpsUrl(value.sourceUrl) &&
      typeof value.license === 'string' &&
      isIsoTimestamp(value.checkedAt)
    );
  }
  return (
    value.provenance === 'owner_asserted' &&
    hasAllowedKeys(
      value,
      [
        'status',
        'provenance',
        'address',
        'latitude',
        'longitude',
        'assertedAt',
        'sourceUrl',
      ],
      [
        'status',
        'provenance',
        'address',
        'latitude',
        'longitude',
        'assertedAt',
      ],
    ) &&
    typeof value.address === 'string' &&
    isCoordinates(value) &&
    isIsoTimestamp(value.assertedAt) &&
    (value.sourceUrl === undefined || isCanonicalHttpsUrl(value.sourceUrl))
  );
}

function isReviewTabelog(value: unknown): boolean {
  if (hasExactKeys(value, ['status'])) return value.status === 'unknown';
  if (!isRecord(value) || value.status !== 'known') return false;
  const timeKey =
    value.provenance === 'owner_asserted'
      ? 'assertedAt'
      : value.provenance === 'agent_observed'
        ? 'observedAt'
        : undefined;
  return Boolean(
    timeKey &&
    hasAllowedKeys(
      value,
      [
        'status',
        'score',
        'reviewCount',
        'url',
        'provenance',
        timeKey,
        'freshness',
      ],
      ['status', 'score', 'url', 'provenance', timeKey, 'freshness'],
    ) &&
    typeof value.score === 'number' &&
    Number.isFinite(value.score) &&
    value.score >= 0 &&
    value.score <= 5 &&
    (value.reviewCount === undefined ||
      (typeof value.reviewCount === 'number' &&
        Number.isInteger(value.reviewCount) &&
        value.reviewCount >= 0)) &&
    isCanonicalHttpsUrl(value.url) &&
    isIsoTimestamp(value[timeKey]) &&
    (value.freshness === 'fresh' || value.freshness === 'stale'),
  );
}

function isReviewReservation(value: unknown): boolean {
  if (hasExactKeys(value, ['status'])) return value.status === 'unknown';
  if (!isRecord(value) || value.status !== 'known') return false;
  const timeKey =
    value.provenance === 'owner_asserted'
      ? 'assertedAt'
      : value.provenance === 'agent_observed'
        ? 'observedAt'
        : undefined;
  return Boolean(
    timeKey &&
    hasAllowedKeys(
      value,
      [
        'status',
        'mode',
        'label',
        'advanceDays',
        'bookingWindowLabel',
        'releaseNote',
        'channel',
        'url',
        'provenance',
        timeKey,
        'freshness',
      ],
      ['status', 'mode', 'label', 'url', 'provenance', timeKey, 'freshness'],
    ) &&
    (value.mode === 'reservable' ||
      value.mode === 'reservation_required' ||
      value.mode === 'not_reservable') &&
    typeof value.label === 'string' &&
    (value.advanceDays === undefined ||
      (typeof value.advanceDays === 'number' &&
        Number.isInteger(value.advanceDays) &&
        value.advanceDays >= 0)) &&
    (value.bookingWindowLabel === undefined ||
      typeof value.bookingWindowLabel === 'string') &&
    (value.releaseNote === undefined ||
      typeof value.releaseNote === 'string') &&
    (value.channel === undefined || typeof value.channel === 'string') &&
    isCanonicalHttpsUrl(value.url) &&
    isIsoTimestamp(value[timeKey]) &&
    (value.freshness === 'fresh' || value.freshness === 'stale'),
  );
}

function isReviewWarning(value: unknown): boolean {
  return (
    hasExactKeys(value, ['code', 'message']) &&
    (value.code === 'stale_evidence' ||
      value.code === 'provider_unavailable' ||
      value.code === 'source_conflict' ||
      value.code === 'needs_review') &&
    typeof value.message === 'string' &&
    value.message.length >= 1 &&
    value.message.length <= 300
  );
}

function isOrderedUniqueValues(value: unknown, order: readonly string[]) {
  return (
    Array.isArray(value) &&
    value.length <= order.length &&
    value.every(
      (entry, index) =>
        typeof entry === 'string' &&
        order.includes(entry) &&
        (index === 0 || order.indexOf(value[index - 1]) < order.indexOf(entry)),
    )
  );
}

function isCoordinates(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.latitude === 'number' &&
    Number.isFinite(value.latitude) &&
    value.latitude >= -90 &&
    value.latitude <= 90 &&
    typeof value.longitude === 'number' &&
    Number.isFinite(value.longitude) &&
    value.longitude >= -180 &&
    value.longitude <= 180
  );
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function isCanonicalHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash &&
      parsed.toString() === value
    );
  } catch {
    return false;
  }
}

function hasExactKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return hasAllowedKeys(value, keys, keys);
}

function hasAllowedKeys(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.every((key) => allowed.includes(key)) &&
    required.every((key) => keys.includes(key))
  );
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
    (value.intakeEvidence === undefined ||
      isReviewEvidence(value.intakeEvidence)) &&
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
    (value.checkedAt === undefined || typeof value.checkedAt === 'string')
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
