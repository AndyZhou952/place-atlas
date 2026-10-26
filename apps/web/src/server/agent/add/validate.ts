// Validation for the Add workflow: operation inputs, provider and research outputs, and the
// evidence helpers that keep a re-observed fact from invalidating the Owner's confirmation.
import { success, type ApplicationErrorKind } from '../../../shared/result.ts';
import { canonicalizeCatalogIntakeWarnings } from '../../../shared/catalog-intake-warnings.ts';
import { formatOpeningHours } from '../../../shared/hours.ts';
import type {
  AddError,
  AddErrorCode,
  AddResult,
  CatalogIntakeCancelInput,
  CatalogIntakeConfirmInput,
  CatalogIntakeDiscoverInput,
  CatalogIntakeEnrichedProfile,
  CatalogIntakeOwnerFields,
  CatalogIntakePreview,
  CatalogIntakeReservationSnapshot,
  CatalogIntakeScope,
  CatalogIntakeSelectInput,
  CatalogIntakeTabelogSnapshot,
  CatalogIntakeWarning,
  OwnerReservationAssertion,
  OwnerTabelogAssertion,
} from '../../../shared/catalog-intake.ts';
import type { DurableGeocoderProposal, GooglePlaceDiscoveryCandidate } from './workflow.ts';

export function validateDiscoveryCandidate(
  value: unknown,
): GooglePlaceDiscoveryCandidate | undefined {
  return validateDiscoveryResult({ candidates: [value], hasMore: false })?.candidates[0];
}

export function validateDurableGeocoderProposal(
  value: unknown,
): DurableGeocoderProposal | undefined {
  if (
    isRecordWithExactKeys(value, ['status']) &&
    (value.status === 'ambiguous' || value.status === 'no_match')
  ) {
    return { status: value.status };
  }
  if (
    !isRecordWithExactKeys(value, [
      'status',
      'normalizedAddress',
      'latitude',
      'longitude',
      'provider',
      'sourceUrl',
      'license',
      'checkedAt',
    ]) ||
    value.status !== 'resolved'
  ) {
    return undefined;
  }
  const normalizedAddress = normalizeBoundedText(value.normalizedAddress, 1, 500);
  const coordinates = validateCoordinates({ latitude: value.latitude, longitude: value.longitude });
  const provider = normalizeBoundedText(value.provider, 1, 120);
  const license = normalizeBoundedText(value.license, 1, 200);
  const checkedAt = normalizeIsoTimestamp(value.checkedAt);
  if (
    !normalizedAddress ||
    !coordinates ||
    !provider ||
    !isCanonicalHttpsUrl(value.sourceUrl) ||
    !license ||
    !checkedAt
  ) {
    return undefined;
  }
  return {
    status: 'resolved',
    normalizedAddress,
    ...coordinates,
    provider,
    sourceUrl: value.sourceUrl,
    license,
    checkedAt,
  };
}

export function addFailure(
  code: AddErrorCode,
  message: string,
  retryable = false,
): AddResult<never> {
  const internalKinds: Record<AddErrorCode, ApplicationErrorKind> = {
    invalid_input: 'invalid_input',
    unauthorized: 'invalid_input',
    forbidden: 'invalid_input',
    not_found: 'not_found',
    conflict: 'conflict',
    expired: 'conflict',
    dependency_failure: 'dependency_failure',
    rate_limited: 'dependency_failure',
    unexpected_failure: 'unexpected_failure',
  };
  const error = { code, message, retryable } as AddError;
  Object.defineProperty(error, 'kind', {
    value: internalKinds[code],
    enumerable: false,
    writable: false,
  });
  return { ok: false, error };
}

export function validateDiscoveryResult(value: unknown):
  | {
      readonly candidates: readonly GooglePlaceDiscoveryCandidate[];
      readonly hasMore: boolean;
    }
  | undefined {
  if (
    !isRecordWithExactKeys(value, ['candidates', 'hasMore']) ||
    !Array.isArray(value.candidates) ||
    value.candidates.length > 3 ||
    typeof value.hasMore !== 'boolean'
  ) {
    return undefined;
  }
  const ordinals = new Set<number>();
  const identities = new Set<string>();
  const candidates: GooglePlaceDiscoveryCandidate[] = [];
  for (const candidate of value.candidates) {
    if (
      !isRecordWithExactKeys(candidate, ['durableIdentity', 'transientPresentation']) ||
      !isRecordWithExactKeys(candidate.durableIdentity, [
        'providerNamespace',
        'placeId',
        'ordinal',
      ]) ||
      !isRecordWithExactKeys(candidate.transientPresentation, ['name', 'address', 'attribution']) ||
      !isRecordWithExactKeys(candidate.transientPresentation.attribution, ['label', 'url'])
    ) {
      return undefined;
    }
    const providerNamespace = normalizeBoundedText(
      candidate.durableIdentity.providerNamespace,
      1,
      100,
    );
    const placeId = normalizeBoundedText(candidate.durableIdentity.placeId, 1, 500);
    const ordinal = candidate.durableIdentity.ordinal;
    const name = normalizeBoundedText(candidate.transientPresentation.name, 1, 500);
    const address = normalizeBoundedText(candidate.transientPresentation.address, 1, 500);
    const label = normalizeBoundedText(candidate.transientPresentation.attribution.label, 1, 120);
    const url = candidate.transientPresentation.attribution.url;
    if (
      !providerNamespace ||
      !placeId ||
      !isPositiveInteger(ordinal) ||
      ordinals.has(ordinal) ||
      identities.has(`${providerNamespace}\u0000${placeId}`) ||
      !name ||
      !address ||
      !label ||
      !isCanonicalHttpsUrl(url)
    ) {
      return undefined;
    }
    ordinals.add(ordinal);
    identities.add(`${providerNamespace}\u0000${placeId}`);
    candidates.push({
      durableIdentity: { providerNamespace, placeId, ordinal },
      transientPresentation: { name, address, attribution: { label, url } },
    });
  }
  return { candidates, hasMore: value.hasMore };
}

export function validateDiscoverInput(input: unknown): AddResult<CatalogIntakeDiscoverInput> {
  if (!isRecordWithExactKeys(input, ['query', 'requestToken'])) {
    return addFailure('invalid_input', 'A query and request token are required.');
  }
  const query = normalizeBoundedText(input.query, 1, 500);
  const requestToken = normalizeBoundedText(input.requestToken, 1, 200);
  if (!query || !requestToken) {
    return addFailure('invalid_input', 'A query and request token are required.');
  }
  return success({ query, requestToken });
}

export function validateSelectInput(input: unknown): AddResult<CatalogIntakeSelectInput> {
  if (
    !isRecordWithAllowedKeys(
      input,
      [
        'sessionId',
        'expectedSessionVersion',
        'ordinal',
        'ownerFields',
        'tabelog',
        'reservation',
        'requestResearch',
      ],
      ['sessionId', 'expectedSessionVersion', 'ordinal'],
    )
  ) {
    return addFailure('invalid_input', 'A valid intake selection is required.');
  }
  const sessionId = normalizeBoundedText(input.sessionId, 1, 200);
  if (
    !sessionId ||
    !isPositiveInteger(input.expectedSessionVersion) ||
    !isPositiveInteger(input.ordinal) ||
    (input.requestResearch !== undefined && typeof input.requestResearch !== 'boolean')
  ) {
    return addFailure('invalid_input', 'A valid intake selection is required.');
  }
  const ownerFields = validateOwnerFields(input.ownerFields);
  if (input.ownerFields !== undefined && !ownerFields) {
    return addFailure('invalid_input', 'Owner fields are invalid.');
  }
  const tabelog = validateOwnerTabelog(input.tabelog);
  if (input.tabelog !== undefined && !tabelog) {
    return addFailure('invalid_input', 'The Tabelog assertion is invalid.');
  }
  const reservation = validateOwnerReservation(input.reservation);
  if (input.reservation !== undefined && !reservation) {
    return addFailure('invalid_input', 'The reservation assertion is invalid.');
  }
  return success({
    sessionId,
    expectedSessionVersion: input.expectedSessionVersion,
    ordinal: input.ordinal,
    ...(ownerFields ? { ownerFields } : {}),
    ...(tabelog ? { tabelog } : {}),
    ...(reservation ? { reservation } : {}),
    ...(input.requestResearch !== undefined ? { requestResearch: input.requestResearch } : {}),
  });
}

export function validateConfirmInput(input: unknown): AddResult<CatalogIntakeConfirmInput> {
  if (!isRecordWithExactKeys(input, ['sessionId', 'expectedPreviewVersion'])) {
    return addFailure('invalid_input', 'A valid intake confirmation is required.');
  }
  const sessionId = normalizeBoundedText(input.sessionId, 1, 200);
  if (!sessionId || !isPositiveInteger(input.expectedPreviewVersion)) {
    return addFailure('invalid_input', 'A valid intake confirmation is required.');
  }
  return success({ sessionId, expectedPreviewVersion: input.expectedPreviewVersion });
}

export function validateCancelInput(input: unknown): AddResult<CatalogIntakeCancelInput> {
  if (!isRecordWithExactKeys(input, ['sessionId', 'expectedSessionVersion'])) {
    return addFailure('invalid_input', 'A valid intake cancellation is required.');
  }
  const sessionId = normalizeBoundedText(input.sessionId, 1, 200);
  if (!sessionId || !isPositiveInteger(input.expectedSessionVersion)) {
    return addFailure('invalid_input', 'A valid intake cancellation is required.');
  }
  return success({ sessionId, expectedSessionVersion: input.expectedSessionVersion });
}

export function locationOwnerFields(fields: CatalogIntakeOwnerFields): CatalogIntakeOwnerFields {
  return {
    ...(fields.title ? { title: fields.title } : {}),
    ...(fields.address ? { address: fields.address } : {}),
    ...(fields.area ? { area: fields.area } : {}),
    ...(fields.coordinates ? { coordinates: fields.coordinates } : {}),
  };
}

function validateOwnerFields(value: unknown): CatalogIntakeOwnerFields | undefined {
  if (value === undefined) return {};
  if (
    !isRecordWithAllowedKeys(
      value,
      [
        'title',
        'address',
        'area',
        'coordinates',
        'categories',
        'signatureDishes',
        'summary',
        'openingHours',
        'regularClosingDays',
      ],
      [],
    )
  ) {
    return undefined;
  }
  const title = value.title === undefined ? undefined : normalizeBoundedText(value.title, 1, 200);
  const address =
    value.address === undefined ? undefined : normalizeBoundedText(value.address, 1, 500);
  const area = value.area === undefined ? undefined : normalizeBoundedText(value.area, 0, 120);
  const categories =
    value.categories === undefined ? undefined : validateOwnerLabels(value.categories);
  const signatureDishes =
    value.signatureDishes === undefined ? undefined : validateOwnerLabels(value.signatureDishes);
  const summary =
    value.summary === undefined ? undefined : normalizeBoundedText(value.summary, 1, 1200);
  const coordinates =
    value.coordinates === undefined ? undefined : validateCoordinates(value.coordinates);
  const openingHours = validateOwnerSchedule(value.openingHours, 1200);
  const regularClosingDays = validateOwnerSchedule(value.regularClosingDays, 500);
  if (
    (value.title !== undefined && !title) ||
    (value.address !== undefined && !address) ||
    (value.area !== undefined && area === undefined) ||
    (value.categories !== undefined && !categories) ||
    (value.signatureDishes !== undefined && !signatureDishes) ||
    (value.summary !== undefined && !summary) ||
    (value.openingHours !== undefined && !openingHours) ||
    (value.regularClosingDays !== undefined && !regularClosingDays) ||
    (value.coordinates !== undefined && !coordinates)
  ) {
    return undefined;
  }
  return {
    ...(title ? { title } : {}),
    ...(address ? { address } : {}),
    ...(area !== undefined ? { area } : {}),
    ...(categories ? { categories } : {}),
    ...(signatureDishes ? { signatureDishes } : {}),
    ...(summary ? { summary } : {}),
    ...(openingHours
      ? {
          openingHours: { ...openingHours, value: formatOpeningHours(openingHours.value) },
        }
      : {}),
    ...(regularClosingDays ? { regularClosingDays } : {}),
    ...(coordinates ? { coordinates } : {}),
  };
}

function validateOwnerSchedule(value: unknown, limit: number) {
  if (value === undefined) return undefined;
  if (!isRecordWithAllowedKeys(value, ['value', 'sourceUrl'], ['value', 'sourceUrl']))
    return undefined;
  if (
    typeof value.value !== 'string' ||
    !value.value.trim() ||
    value.value.length > limit ||
    /\p{Cc}/u.test(value.value.replace(/[\r\n\t]/gu, ''))
  )
    return undefined;
  const sourceUrl = isCanonicalHttpsUrl(value.sourceUrl) ? value.sourceUrl : undefined;
  return sourceUrl ? { value: value.value.normalize('NFC').trim(), sourceUrl } : undefined;
}

function validateOwnerLabels(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) {
    return undefined;
  }
  const labels = value.map((entry) => normalizeBoundedText(entry, 1, 100));
  return labels.every((entry) => entry !== undefined) ? (labels as string[]) : undefined;
}

export function validateOwnerTabelog(
  value: unknown,
): OwnerTabelogAssertion | 'unknown' | undefined {
  if (value === undefined || value === 'unknown') return value;
  if (!isRecordWithAllowedKeys(value, ['score', 'reviewCount', 'url'], ['score', 'url'])) {
    return undefined;
  }
  const { score, reviewCount, url } = value;
  if (
    typeof score !== 'number' ||
    !Number.isFinite(score) ||
    score < 0 ||
    score > 5 ||
    !hasAtMostTwoDecimalPlaces(score) ||
    (reviewCount !== undefined &&
      (typeof reviewCount !== 'number' ||
        !Number.isInteger(reviewCount) ||
        reviewCount < 0 ||
        reviewCount > 2_147_483_647)) ||
    !isCanonicalTabelogUrl(url)
  ) {
    return undefined;
  }
  return { score, ...(typeof reviewCount === 'number' ? { reviewCount } : {}), url };
}

export function validateOwnerReservation(
  value: unknown,
): OwnerReservationAssertion | 'unknown' | undefined {
  if (value === undefined || value === 'unknown') return value;
  if (
    !isRecordWithAllowedKeys(
      value,
      ['mode', 'label', 'advanceDays', 'bookingWindowLabel', 'releaseNote', 'channel', 'url'],
      ['mode', 'label', 'url'],
    )
  ) {
    return undefined;
  }
  const { mode, label, advanceDays, bookingWindowLabel, releaseNote, channel, url } = value;
  if (
    (mode !== 'reservable' && mode !== 'reservation_required' && mode !== 'not_reservable') ||
    typeof label !== 'string' ||
    !isOptionalBoundedText(label, 1, 500) ||
    (advanceDays !== undefined &&
      (typeof advanceDays !== 'number' ||
        !Number.isInteger(advanceDays) ||
        advanceDays < 0 ||
        advanceDays > 3650)) ||
    !isOptionalBoundedText(bookingWindowLabel, 0, 500) ||
    !isOptionalBoundedText(releaseNote, 0, 500) ||
    !isOptionalBoundedText(channel, 0, 120) ||
    !isCanonicalHttpsUrl(url, true)
  ) {
    return undefined;
  }
  return {
    mode,
    label: label.normalize('NFC').trim(),
    ...(typeof advanceDays === 'number' ? { advanceDays } : {}),
    ...(typeof bookingWindowLabel === 'string'
      ? { bookingWindowLabel: bookingWindowLabel.normalize('NFC').trim() }
      : {}),
    ...(typeof releaseNote === 'string'
      ? { releaseNote: releaseNote.normalize('NFC').trim() }
      : {}),
    ...(typeof channel === 'string' ? { channel: channel.normalize('NFC').trim() } : {}),
    url,
  };
}

export function validateWebResearchOutput(
  value: unknown,
  preview: Pick<CatalogIntakePreview, 'tabelog' | 'reservation'>,
):
  | {
      readonly tabelog: CatalogIntakeTabelogSnapshot;
      readonly reservation: CatalogIntakeReservationSnapshot;
      readonly profile?: CatalogIntakeEnrichedProfile;
    }
  | undefined {
  if (
    !isRecordWithAllowedKeys(
      value,
      ['tabelog', 'reservation', 'profile'],
      ['tabelog', 'reservation'],
    )
  ) {
    return undefined;
  }
  const tabelog = validateResearchTabelog(value.tabelog, preview.tabelog);
  const reservation = validateResearchReservation(value.reservation, preview.reservation);
  const profile = value.profile === undefined ? undefined : validateEnrichedProfile(value.profile);
  if (value.profile !== undefined && !profile) return undefined;
  return tabelog && reservation
    ? { tabelog, reservation, ...(profile ? { profile } : {}) }
    : undefined;
}

export function validateEnrichedProfile(value: unknown): CatalogIntakeEnrichedProfile | undefined {
  const keys = [
    'name',
    'area',
    'address',
    'coordinates',
    'categories',
    'signatureDishes',
    'summary',
    'openingHours',
    'regularClosingDays',
    'closingNotes',
    'officialWebsite',
    'bookingLink',
    'googleRating',
  ];
  if (!isRecordWithAllowedKeys(value, keys, [])) return undefined;
  const webUrl = (input: unknown) => {
    if (typeof input !== 'string' || input.length > 2048) return false;
    try {
      const url = new URL(input);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
    } catch {
      return false;
    }
  };
  const text = (input: unknown, max = 500) =>
    typeof input === 'string' && input.trim().length > 0 && input.length <= max;
  for (const [key, claim] of Object.entries(value)) {
    if (
      !isRecordWithExactKeys(claim, ['value', 'sourceUrl', 'observedAt']) ||
      !webUrl(claim.sourceUrl) ||
      !normalizeIsoTimestamp(claim.observedAt)
    )
      return undefined;
    const field = claim.value;
    if (key === 'coordinates') {
      if (
        !isRecordWithExactKeys(field, ['latitude', 'longitude']) ||
        typeof field.latitude !== 'number' ||
        !Number.isFinite(field.latitude) ||
        Math.abs(field.latitude) > 90 ||
        typeof field.longitude !== 'number' ||
        !Number.isFinite(field.longitude) ||
        Math.abs(field.longitude) > 180
      )
        return undefined;
    } else if (key === 'googleRating') {
      if (
        !isRecordWithAllowedKeys(field, ['score', 'reviewCount'], ['score']) ||
        typeof field.score !== 'number' ||
        !Number.isFinite(field.score) ||
        field.score < 0 ||
        field.score > 5 ||
        (field.reviewCount !== undefined &&
          (typeof field.reviewCount !== 'number' ||
            !Number.isSafeInteger(field.reviewCount) ||
            field.reviewCount < 0))
      )
        return undefined;
    } else if (key === 'categories' || key === 'signatureDishes') {
      if (!Array.isArray(field) || field.length > 12 || !field.every((entry) => text(entry, 100)))
        return undefined;
    } else if (key === 'officialWebsite' || key === 'bookingLink') {
      if (!webUrl(field)) return undefined;
    } else if (
      !text(
        field,
        key === 'summary' || key === 'openingHours'
          ? 1200
          : key === 'regularClosingDays'
            ? 500
            : 500,
      )
    )
      return undefined;
  }
  // Every allowed field, sourced wrapper, and value shape was checked above.
  return value as CatalogIntakeEnrichedProfile;
}

function validateResearchTabelog(
  value: unknown,
  prior: CatalogIntakeTabelogSnapshot,
): CatalogIntakeTabelogSnapshot | undefined {
  if (isRecordWithExactKeys(value, ['status']) && value.status === 'unknown') {
    return { status: 'unknown' };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const provenance = record.provenance;
  const timestampKey =
    provenance === 'agent_observed'
      ? 'observedAt'
      : provenance === 'owner_asserted'
        ? 'assertedAt'
        : undefined;
  const allowed = timestampKey
    ? ['status', 'score', 'reviewCount', 'url', 'provenance', timestampKey, 'freshness']
    : [];
  if (
    !timestampKey ||
    !isRecordWithAllowedKeys(record, allowed, [
      'status',
      'score',
      'url',
      'provenance',
      timestampKey,
      'freshness',
    ]) ||
    record.status !== 'known' ||
    (record.freshness !== 'fresh' && record.freshness !== 'stale') ||
    !normalizeIsoTimestamp(record[timestampKey])
  ) {
    return undefined;
  }
  const assertion = validateOwnerTabelog({
    score: record.score,
    ...(record.reviewCount === undefined ? {} : { reviewCount: record.reviewCount }),
    url: record.url,
  });
  if (!assertion || assertion === 'unknown') return undefined;
  const normalized = {
    status: 'known' as const,
    ...assertion,
    provenance,
    [timestampKey]: record[timestampKey],
    freshness: record.freshness,
  } as CatalogIntakeTabelogSnapshot;
  return provenance === 'owner_asserted' && canonicalJson(normalized) !== canonicalJson(prior)
    ? undefined
    : normalized;
}

function validateResearchReservation(
  value: unknown,
  prior: CatalogIntakeReservationSnapshot,
): CatalogIntakeReservationSnapshot | undefined {
  if (isRecordWithExactKeys(value, ['status']) && value.status === 'unknown') {
    return { status: 'unknown' };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const provenance = record.provenance;
  const timestampKey =
    provenance === 'agent_observed'
      ? 'observedAt'
      : provenance === 'owner_asserted'
        ? 'assertedAt'
        : undefined;
  const assertionKeys = [
    'mode',
    'label',
    'advanceDays',
    'bookingWindowLabel',
    'releaseNote',
    'channel',
    'url',
  ] as const;
  if (
    !timestampKey ||
    !isRecordWithAllowedKeys(
      record,
      ['status', 'provenance', timestampKey, 'freshness', ...assertionKeys],
      ['status', 'mode', 'label', 'url', 'provenance', timestampKey, 'freshness'],
    ) ||
    record.status !== 'known' ||
    (record.freshness !== 'fresh' && record.freshness !== 'stale') ||
    !normalizeIsoTimestamp(record[timestampKey])
  ) {
    return undefined;
  }
  const assertion = validateOwnerReservation(
    Object.fromEntries(
      assertionKeys.flatMap((key) => (record[key] === undefined ? [] : [[key, record[key]]])),
    ),
  );
  if (!assertion || assertion === 'unknown') return undefined;
  const normalized = {
    status: 'known' as const,
    ...assertion,
    provenance,
    [timestampKey]: record[timestampKey],
    freshness: record.freshness,
  } as CatalogIntakeReservationSnapshot;
  return provenance === 'owner_asserted' && canonicalJson(normalized) !== canonicalJson(prior)
    ? undefined
    : normalized;
}

function validateCoordinates(value: unknown) {
  if (
    !isRecordWithExactKeys(value, ['latitude', 'longitude']) ||
    typeof value.latitude !== 'number' ||
    typeof value.longitude !== 'number' ||
    !Number.isFinite(value.latitude) ||
    !Number.isFinite(value.longitude) ||
    value.latitude < -90 ||
    value.latitude > 90 ||
    value.longitude < -180 ||
    value.longitude > 180
  ) {
    return undefined;
  }
  return { latitude: value.latitude, longitude: value.longitude };
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function normalizeIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const timestamp = new Date(value);
  return Number.isFinite(timestamp.getTime()) && timestamp.toISOString() === value
    ? value
    : undefined;
}

function isOptionalBoundedText(value: unknown, minimum: number, maximum: number): boolean {
  return value === undefined || normalizeBoundedText(value, minimum, maximum) !== undefined;
}

function isCanonicalHttpsUrl(value: unknown, allowFragment = false): value is string {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      !parsed.username &&
      !parsed.password &&
      (allowFragment || !parsed.hash) &&
      parsed.toString() === value
    );
  } catch {
    return false;
  }
}

function isCanonicalTabelogUrl(value: unknown): value is string {
  if (!isCanonicalHttpsUrl(value)) return false;
  const parsed = new URL(value);
  return (
    (parsed.hostname === 'tabelog.com' || parsed.hostname === 'www.tabelog.com') &&
    !parsed.search &&
    /^\/[a-z][a-z0-9-]{0,63}\/A\d{1,12}\/A\d{1,12}\/\d{1,20}\/$/u.test(parsed.pathname)
  );
}

function hasAtMostTwoDecimalPlaces(value: number): boolean {
  const scaled = value * 100;
  return (
    Math.abs(scaled - Math.round(scaled)) <= Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4
  );
}

export function normalizeBoundedText(
  value: unknown,
  minimum: number,
  maximum: number,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.normalize('NFC').trim();
  return normalized.length >= minimum && normalized.length <= maximum && !/\p{Cc}/u.test(normalized)
    ? normalized
    : undefined;
}

function isRecordWithExactKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isRecordWithAllowedKeys(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return keys.every((key) => allowed.includes(key)) && required.every((key) => keys.includes(key));
}

const confirmProviderUnavailableWarning: CatalogIntakeWarning = {
  code: 'provider_unavailable',
  message:
    'One or more enabled evidence providers could not be refreshed; retained evidence is stale or unknown.',
};

const staleEvidenceWarning: CatalogIntakeWarning = {
  code: 'stale_evidence',
  message: 'Previously observed evidence could not be refreshed and must be reviewed.',
};

export function withConfirmProviderUnavailableWarning(
  warnings: readonly CatalogIntakeWarning[],
  includeStaleEvidence: boolean,
): readonly CatalogIntakeWarning[] {
  return canonicalizeCatalogIntakeWarnings(
    warnings
      .filter(({ code }) => code !== 'stale_evidence' && code !== 'provider_unavailable')
      .concat(
        includeStaleEvidence ? [staleEvidenceWarning] : [],
        confirmProviderUnavailableWarning,
      ),
  );
}

export function hasStaleAgentEvidence(
  tabelog: CatalogIntakeTabelogSnapshot,
  reservation: CatalogIntakeReservationSnapshot,
): boolean {
  return [tabelog, reservation].some(
    (snapshot) =>
      snapshot.status === 'known' &&
      snapshot.provenance === 'agent_observed' &&
      snapshot.freshness === 'stale',
  );
}

export function withoutRefreshFailureWarnings(
  warnings: readonly CatalogIntakeWarning[],
): readonly CatalogIntakeWarning[] {
  return canonicalizeCatalogIntakeWarnings(
    warnings.filter(({ code }) => code !== 'stale_evidence' && code !== 'provider_unavailable'),
  );
}

export function markAgentTabelogStale(
  snapshot: CatalogIntakeTabelogSnapshot,
): CatalogIntakeTabelogSnapshot {
  return snapshot.status === 'known' &&
    snapshot.provenance === 'agent_observed' &&
    snapshot.freshness !== 'stale'
    ? { ...snapshot, freshness: 'stale' }
    : snapshot;
}

export function markAgentReservationStale(
  snapshot: CatalogIntakeReservationSnapshot,
): CatalogIntakeReservationSnapshot {
  return snapshot.status === 'known' &&
    snapshot.provenance === 'agent_observed' &&
    snapshot.freshness !== 'stale'
    ? { ...snapshot, freshness: 'stale' }
    : snapshot;
}

export function stabilizeResearchEvidence(
  refreshed: {
    readonly tabelog: CatalogIntakeTabelogSnapshot;
    readonly reservation: CatalogIntakeReservationSnapshot;
  },
  prior: CatalogIntakePreview,
) {
  return {
    tabelog: stabilizeResearchSnapshot(refreshed.tabelog, prior.tabelog, markAgentTabelogStale),
    reservation: stabilizeResearchSnapshot(
      refreshed.reservation,
      prior.reservation,
      markAgentReservationStale,
    ),
  };
}

function stabilizeResearchSnapshot<Snapshot>(
  refreshed: Snapshot & { readonly status: 'known' | 'unknown' },
  prior: Snapshot & { readonly status: 'known' | 'unknown' },
  markStale: (snapshot: Snapshot) => Snapshot,
): Snapshot {
  if (refreshed.status === 'unknown' && prior.status === 'known') {
    return markStale(prior);
  }
  return sameAgentObservedFacts(refreshed, prior) ? prior : refreshed;
}

function sameAgentObservedFacts(left: unknown, right: unknown): boolean {
  if (
    !isRecord(left) ||
    !isRecord(right) ||
    left.status !== 'known' ||
    right.status !== 'known' ||
    left.provenance !== 'agent_observed' ||
    right.provenance !== 'agent_observed'
  ) {
    return false;
  }
  const { observedAt: _leftObservedAt, ...leftFacts } = left;
  const { observedAt: _rightObservedAt, ...rightFacts } = right;
  return canonicalJson(leftFacts) === canonicalJson(rightFacts);
}

export function sameCandidateIdentity(
  left: CatalogIntakePreview['candidateIdentity'],
  right: CatalogIntakePreview['candidateIdentity'],
): boolean {
  return left.providerNamespace === right.providerNamespace && left.placeId === right.placeId;
}

export function mergeEnrichedProfile(
  refreshed: CatalogIntakeEnrichedProfile | undefined,
  prior: CatalogIntakeEnrichedProfile | undefined,
): CatalogIntakeEnrichedProfile | undefined {
  if (!refreshed && !prior) return undefined;
  const merged = { ...prior, ...refreshed };
  for (const field of Object.keys(refreshed ?? {}) as (keyof CatalogIntakeEnrichedProfile)[]) {
    const next = refreshed?.[field];
    const previous = prior?.[field];
    // Reobserving the same sourced fact must not invalidate owner confirmation.
    if (
      next &&
      previous &&
      next.sourceUrl === previous.sourceUrl &&
      canonicalJson(next.value) === canonicalJson(previous.value)
    ) {
      Object.assign(merged, { [field]: previous });
    }
  }
  return merged;
}

export async function digestCanonical(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function catalogIntakeCanonicalResearchUrls(
  preview: Pick<CatalogIntakePreview, 'tabelog' | 'reservation'>,
): readonly string[] {
  return [
    ...new Set([
      ...(preview.tabelog.status === 'known' ? [preview.tabelog.url] : []),
      ...(preview.reservation.status === 'known' ? [preview.reservation.url] : []),
    ]),
  ].sort(codeUnitOrder);
}

export function deriveAddConfirmMutationKey(
  scope: CatalogIntakeScope,
  preview: CatalogIntakePreview,
): Promise<string> {
  return deriveAddConfirmMutationKeyFromParts(
    scope,
    preview.sessionId,
    preview.previewVersion,
    preview.evidenceDigest,
  );
}

export function deriveAddConfirmMutationKeyFromParts(
  scope: CatalogIntakeScope,
  sessionId: string,
  previewVersion: number,
  evidenceDigest: string,
): Promise<string> {
  return digestCanonical([
    'add-confirm:v1',
    scope.ownerId,
    'catalog.intake.confirm',
    sessionId,
    previewVersion,
    evidenceDigest,
  ]);
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => codeUnitOrder(left, right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`;
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
