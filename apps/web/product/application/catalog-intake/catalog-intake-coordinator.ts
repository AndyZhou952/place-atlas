import { normalizeSearchText } from '../decision/search-policy.ts';
import { failure, success, type Result } from '../result.ts';
import type {
  DiscoveredPlaceCandidate,
  PlaceDiscoveryProvider,
} from './place-discovery.ts';

export interface CatalogIntakeCatalogItem {
  readonly itemId: string;
  readonly name: string;
  readonly address: string;
  readonly coordinates?: {
    readonly latitude: number;
    readonly longitude: number;
  };
  readonly strongIdentities: readonly {
    readonly providerNamespace: string;
    readonly stablePlaceId: string;
  }[];
}

export interface CatalogIntakeCatalogSnapshot {
  readonly revision: string;
  readonly items: readonly CatalogIntakeCatalogItem[];
}

export interface CatalogIntakeCatalogRead {
  readSnapshot(): Promise<CatalogIntakeCatalogSnapshot>;
}

export type CatalogIntakeQuery =
  | {
      readonly kind: 'name';
      readonly name: string;
      readonly near?: string;
    }
  | {
      readonly kind: 'address';
      readonly address: string;
    };

export type CatalogIntakeEvent =
  | {
      readonly type: 'discover';
      readonly sessionId: string;
      readonly query: CatalogIntakeQuery;
    }
  | {
      readonly type: 'select';
      readonly sessionId: string;
      readonly candidateId: string;
    }
  | {
      readonly type: 'cancel';
      readonly sessionId: string;
    };

export interface CatalogIntakeEvidence {
  readonly candidateId: string;
  readonly strongIdentity: DiscoveredPlaceCandidate['strongIdentity'];
  readonly name: DiscoveredPlaceCandidate['name'];
  readonly address: DiscoveredPlaceCandidate['address'];
  readonly branch: NonNullable<DiscoveredPlaceCandidate['branch']>;
  readonly area: NonNullable<DiscoveredPlaceCandidate['area']>;
  readonly coordinates: DiscoveredPlaceCandidate['coordinates'];
  readonly externalRating: DiscoveredPlaceCandidate['externalRating'];
  readonly source: DiscoveredPlaceCandidate['source'];
}

export interface CatalogIntakePreview {
  readonly sessionId: string;
  readonly candidateId: string;
  readonly previewVersion: number;
  readonly catalogRevision: string;
  readonly evidenceDigest: string;
  readonly evidence: CatalogIntakeEvidence;
  readonly suspectedDuplicates: readonly CatalogIntakeCatalogItem[];
  readonly presentation: {
    readonly kind: 'food';
    readonly area: CatalogIntakeCandidateSummary['area'];
    readonly map:
      | { readonly status: 'unknown' }
      | {
          readonly status: 'available';
          readonly deepLink: string;
          readonly attribution: {
            readonly label: string;
            readonly url: string;
          };
        };
    readonly reservation: { readonly status: 'unknown' };
    readonly unknownFields: readonly string[];
  };
}

export interface CatalogIntakeCandidateSummary {
  readonly candidateId: string;
  readonly name: string;
  readonly address: string;
  readonly branch:
    | { readonly status: 'unknown' }
    | { readonly status: 'known'; readonly value: string };
  readonly area:
    | { readonly status: 'unknown' }
    | { readonly status: 'known'; readonly value: string };
}

export type CatalogIntakeOutcome =
  | {
      readonly status: 'selection_required';
      readonly candidates: readonly CatalogIntakeCandidateSummary[];
    }
  | {
      readonly status: 'preview';
      readonly preview: CatalogIntakePreview;
    }
  | {
      readonly status: 'existing_item';
      readonly item: CatalogIntakeCatalogItem;
      readonly match: {
        readonly kind: 'strong_identity';
        readonly providerNamespace: string;
        readonly stablePlaceId: string;
      };
    }
  | {
      readonly status: 'cancelled';
    };

type CatalogIntakeStoredSession =
  | {
      readonly status: 'selection_required';
      readonly sessionId: string;
      readonly catalogRevision: string;
      readonly evidence: readonly CatalogIntakeEvidence[];
      readonly catalogItems: readonly CatalogIntakeCatalogItem[];
    }
  | {
      readonly status: 'preview';
      readonly sessionId: string;
      readonly preview: CatalogIntakePreview;
    }
  | {
      readonly status: 'cancelled';
      readonly sessionId: string;
    };

export interface CatalogIntakeStore {
  get(sessionId: string): Promise<CatalogIntakeStoredSession | undefined>;
  put(session: CatalogIntakeStoredSession): Promise<void>;
}

export interface CatalogIntakeCoordinator {
  handle(event: CatalogIntakeEvent): Promise<Result<CatalogIntakeOutcome>>;
}

export function createCatalogIntakeCoordinator(options: {
  readonly catalog: CatalogIntakeCatalogRead;
  readonly discoveryProvider: PlaceDiscoveryProvider;
  readonly store: CatalogIntakeStore;
  readonly clock: { now(): Date };
}): CatalogIntakeCoordinator {
  return {
    async handle(event) {
      if (event.type === 'cancel') {
        const session = await options.store.get(event.sessionId);
        if (!session) {
          return failure('not_found', 'Catalog intake session was not found.');
        }
        await options.store.put({
          status: 'cancelled',
          sessionId: event.sessionId,
        });
        return success({ status: 'cancelled' });
      }

      if (event.type === 'select') {
        const session = await options.store.get(event.sessionId);
        if (session?.status !== 'selection_required') {
          return failure(
            'not_found',
            'Catalog intake selection was not found.',
          );
        }
        const evidence = session.evidence.find(
          (candidate) => candidate.candidateId === event.candidateId,
        );
        if (!evidence) {
          return failure(
            'invalid_input',
            'Catalog intake candidate was not found.',
          );
        }
        const existing = session.catalogItems.find((item) =>
          item.strongIdentities.some(
            (identity) =>
              identity.providerNamespace ===
                evidence.strongIdentity.providerNamespace &&
              identity.stablePlaceId === evidence.strongIdentity.stablePlaceId,
          ),
        );
        if (existing) {
          return success({
            status: 'existing_item',
            item: existing,
            match: { kind: 'strong_identity', ...evidence.strongIdentity },
          });
        }
        const preview = await createPreview(
          event.sessionId,
          session.catalogRevision,
          evidence,
          session.catalogItems,
        );
        await options.store.put({
          status: 'preview',
          sessionId: event.sessionId,
          preview,
        });
        return success({ status: 'preview', preview });
      }

      const priorSession = await options.store.get(event.sessionId);
      if (priorSession?.status === 'cancelled') {
        return success({ status: 'cancelled' });
      }

      const requiredClue =
        event.query.kind === 'name'
          ? event.query.name.trim()
          : event.query.address.trim();
      if (!requiredClue) {
        return failure(
          'invalid_input',
          'A restaurant name or address is required.',
        );
      }
      const providerRequest =
        event.query.kind === 'name'
          ? {
              name: requiredClue,
              ...(event.query.near?.trim()
                ? { near: event.query.near.trim() }
                : {}),
            }
          : {
              name: requiredClue,
              address: requiredClue,
            };
      const catalog = await options.catalog.readSnapshot();
      const discovered =
        await options.discoveryProvider.discover(providerRequest);
      if (!discovered.ok) return discovered;
      if (
        discovered.value.candidates.some(
          (candidate) => !hasDurableEvidence(candidate, options.clock.now()),
        )
      ) {
        return failure(
          'dependency_failure',
          'Place discovery returned unlicensed or incomplete evidence.',
        );
      }
      if (discovered.value.candidates.length === 0) {
        return failure('not_found', 'No place candidates were found.');
      }

      if (discovered.value.candidates.length === 1) {
        const identity = discovered.value.candidates[0].strongIdentity;
        const existing = catalog.items.find((item) =>
          item.strongIdentities.some(
            (stored) =>
              stored.providerNamespace === identity.providerNamespace &&
              stored.stablePlaceId === identity.stablePlaceId,
          ),
        );
        if (existing) {
          return success({
            status: 'existing_item',
            item: existing,
            match: { kind: 'strong_identity', ...identity },
          });
        }
      }

      const evidence = await Promise.all(
        discovered.value.candidates.slice(0, 3).map(createEvidence),
      );
      if (discovered.value.candidates.length > 1) {
        const frozenEvidence = deepFreeze(evidence);
        await options.store.put({
          status: 'selection_required',
          sessionId: event.sessionId,
          catalogRevision: catalog.revision,
          evidence: frozenEvidence,
          catalogItems: cloneCatalogItems(catalog.items),
        });
        return success({
          status: 'selection_required',
          candidates: deepFreeze(
            frozenEvidence.map((candidate) => ({
              candidateId: candidate.candidateId,
              name: candidate.name.value,
              address: candidate.address.value,
              branch: summarizeOptionalText(candidate.branch),
              area: summarizeOptionalText(candidate.area),
            })),
          ),
        });
      }

      const preview = await createPreview(
        event.sessionId,
        catalog.revision,
        evidence[0],
        catalog.items,
      );
      await options.store.put({
        status: 'preview',
        sessionId: event.sessionId,
        preview,
      });
      return success({ status: 'preview', preview });
    },
  };
}

export function createInMemoryCatalogIntakeStore(): CatalogIntakeStore {
  const sessions = new Map<string, CatalogIntakeStoredSession>();
  return {
    async get(sessionId) {
      return sessions.get(sessionId);
    },
    async put(session) {
      sessions.set(session.sessionId, session);
    },
  };
}

async function createEvidence(
  candidate: DiscoveredPlaceCandidate,
): Promise<CatalogIntakeEvidence> {
  const candidateId = await digestCanonical({
    identity: candidate.strongIdentity,
    source: candidate.source,
  });
  return deepFreeze({
    candidateId,
    strongIdentity: candidate.strongIdentity,
    name: candidate.name,
    address: candidate.address,
    branch: candidate.branch ?? { status: 'unknown' },
    area: candidate.area ?? { status: 'unknown' },
    coordinates: candidate.coordinates,
    externalRating: candidate.externalRating,
    source: candidate.source,
  });
}

function summarizeOptionalText(
  fact: CatalogIntakeEvidence['branch'],
): CatalogIntakeCandidateSummary['branch'] {
  return fact.status === 'known'
    ? { status: 'known', value: fact.value }
    : { status: 'unknown' };
}

async function createPreview(
  sessionId: string,
  catalogRevision: string,
  evidence: CatalogIntakeEvidence,
  catalogItems: readonly CatalogIntakeCatalogItem[],
): Promise<CatalogIntakePreview> {
  return deepFreeze({
    sessionId,
    candidateId: evidence.candidateId,
    previewVersion: 1,
    catalogRevision,
    evidenceDigest: await digestCanonical(evidence),
    evidence,
    suspectedDuplicates: findWeakMatches(evidence, catalogItems),
    presentation: {
      kind: 'food',
      area: summarizeOptionalText(evidence.area),
      map: createMapPresentation(evidence),
      reservation: { status: 'unknown' },
      unknownFields: [
        ...(evidence.area.status === 'unknown' ? ['area'] : []),
        ...(evidence.externalRating.status === 'unknown'
          ? ['external_rating']
          : []),
        'reservation',
      ],
    },
  });
}

function createMapPresentation(
  evidence: CatalogIntakeEvidence,
): CatalogIntakePreview['presentation']['map'] {
  const permission = evidence.source.policy?.mapPresentation;
  if (
    permission?.target !== 'openstreetmap' ||
    permission.coordinateField !== 'coordinates' ||
    !permission.attribution.label.trim() ||
    !isHttpsUrl(permission.attribution.url)
  ) {
    return { status: 'unknown' };
  }
  const point = evidence.coordinates.value;
  return {
    status: 'available',
    attribution: permission.attribution,
    deepLink:
      'https://www.openstreetmap.org/?mlat=' +
      point.latitude +
      '&mlon=' +
      point.longitude +
      '#map=18/' +
      point.latitude +
      '/' +
      point.longitude,
  };
}

function hasDurableEvidence(
  candidate: DiscoveredPlaceCandidate,
  now: Date,
): boolean {
  const durable = new Set(candidate.source.policy?.durableFields ?? []);
  const chat = new Set(candidate.source.policy?.chatFields ?? []);
  if (
    !candidate.source.policy?.version ||
    !['name', 'address', 'coordinates', 'source_url'].every((field) =>
      durable.has(field),
    ) ||
    !['name', 'address'].every((field) => chat.has(field)) ||
    candidate.source.providerId !==
      candidate.strongIdentity.providerNamespace ||
    !candidate.strongIdentity.stablePlaceId ||
    !isSourcedFact(candidate.name, now) ||
    !candidate.name.value.trim() ||
    !isSourcedFact(candidate.address, now) ||
    !candidate.address.value.trim() ||
    !isOptionalTextPermitted(candidate.branch, 'branch', durable, chat, now) ||
    !isOptionalTextPermitted(candidate.area, 'area', durable, chat, now) ||
    !isSourcedFact(candidate.coordinates, now) ||
    !Number.isFinite(candidate.coordinates.value.latitude) ||
    !Number.isFinite(candidate.coordinates.value.longitude) ||
    Math.abs(candidate.coordinates.value.latitude) > 90 ||
    Math.abs(candidate.coordinates.value.longitude) > 180 ||
    !isHttpsUrl(candidate.source.sourceUrl) ||
    !isCheckedAt(candidate.source.checkedAt, now)
  ) {
    return false;
  }
  if (candidate.externalRating.status === 'unknown') return true;
  return (
    durable.has('external_rating') &&
    (candidate.externalRating.reviewCount === undefined ||
      (durable.has('review_count') &&
        Number.isInteger(candidate.externalRating.reviewCount) &&
        candidate.externalRating.reviewCount >= 0)) &&
    Number.isFinite(candidate.externalRating.score) &&
    candidate.externalRating.platform.trim().length > 0 &&
    isHttpsUrl(candidate.externalRating.sourceUrl) &&
    isCheckedAt(candidate.externalRating.checkedAt, now)
  );
}

function isOptionalTextPermitted(
  fact: DiscoveredPlaceCandidate['branch'],
  field: 'branch' | 'area',
  durable: ReadonlySet<string>,
  chat: ReadonlySet<string>,
  now: Date,
): boolean {
  if (!fact || fact.status === 'unknown') return true;
  return (
    durable.has(field) &&
    chat.has(field) &&
    fact.value.trim().length > 0 &&
    isSourcedFact(fact, now)
  );
}

function isSourcedFact(
  fact: { readonly sourceUrl: string; readonly checkedAt: string },
  now: Date,
): boolean {
  return isHttpsUrl(fact.sourceUrl) && isCheckedAt(fact.checkedAt, now);
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isCheckedAt(value: string, now: Date): boolean {
  const checkedAt = Date.parse(value);
  return Number.isFinite(checkedAt) && checkedAt <= now.getTime();
}

function findWeakMatches(
  evidence: CatalogIntakeEvidence,
  items: readonly CatalogIntakeCatalogItem[],
): readonly CatalogIntakeCatalogItem[] {
  const evidenceName = normalizeSearchText(evidence.name.value);
  const evidenceAddress = normalizeSearchText(evidence.address.value);
  return deepFreeze(
    cloneCatalogItems(
      items
        .filter(
          (item) =>
            normalizeSearchText(item.name) === evidenceName ||
            normalizeSearchText(item.address) === evidenceAddress ||
            coordinatesAreNear(item.coordinates, evidence.coordinates.value),
        )
        .slice(0, 3),
    ),
  );
}

function coordinatesAreNear(
  left: CatalogIntakeCatalogItem['coordinates'],
  right: CatalogIntakeEvidence['coordinates']['value'],
): boolean {
  if (!left) return false;
  const latitudeMeters = (left.latitude - right.latitude) * 111_320;
  const longitudeMeters =
    (left.longitude - right.longitude) *
    111_320 *
    Math.cos((right.latitude * Math.PI) / 180);
  return Math.hypot(latitudeMeters, longitudeMeters) <= 100;
}

function cloneCatalogItems(
  items: readonly CatalogIntakeCatalogItem[],
): CatalogIntakeCatalogItem[] {
  return structuredClone(items) as CatalogIntakeCatalogItem[];
}

async function digestCanonical(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`;
}

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
