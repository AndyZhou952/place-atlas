import type {
  DurableGeocoderPort,
  DurableGeocoderProposal,
} from '../../product/application/catalog-intake/catalog-intake-coordinator.ts';
import { validateDurableGeocoderProposal } from '../../product/application/catalog-intake/catalog-intake-coordinator.ts';
import { failure, type Result } from '../../product/application/result.ts';

interface NominatimSearchRequest {
  readonly url: string;
  readonly headers: {
    readonly 'User-Agent': string;
    readonly Referer: string;
  };
}

interface NominatimTransport {
  search(request: NominatimSearchRequest): Promise<Result<unknown>>;
}

export interface DurableGeocoderCache {
  get(key: string): Promise<DurableGeocoderProposal | undefined>;
  set(key: string, value: DurableGeocoderProposal): Promise<void>;
}

export interface NominatimApplicationRateGate {
  reserve(now: Date): Promise<boolean>;
}

export function createNominatimDurableGeocoderAdapter(options: {
  readonly endpoint: string;
  readonly identifyingUserAgent: string;
  readonly referer: string;
  readonly transport: NominatimTransport;
  readonly cache: DurableGeocoderCache;
  readonly rateGate: NominatimApplicationRateGate;
  readonly clock: { now(): Date };
}): DurableGeocoderPort {
  const endpoint = validateEndpoint(options.endpoint);
  const identifyingUserAgent = normalizeText(
    options.identifyingUserAgent,
    10,
    300,
  );
  const referer = validateReferer(options.referer);
  return {
    async propose(input) {
      if (
        (!hasExactKeys(input, [
          'trigger',
          'dataClassification',
          'ownerQuery',
          'ownerDraft',
          'selectedSubject',
        ]) &&
          !hasExactKeys(input, [
            'trigger',
            'dataClassification',
            'ownerQuery',
            'ownerDraft',
          ])) ||
        !hasAllowedKeys(input.ownerDraft, [
          'title',
          'address',
          'area',
          'coordinates',
        ]) ||
        (input.trigger !== 'owner_intake_select' &&
          input.trigger !== 'owner_intake_confirm') ||
        input.dataClassification !== 'public_place_query'
      ) {
        return failure(
          'invalid_input',
          'Durable location lookup requires a direct owner place query.',
        );
      }
      if (!endpoint || !identifyingUserAgent || !referer) {
        return failure(
          'dependency_failure',
          'Durable location lookup is not configured.',
        );
      }
      const query = buildQuery(
        input.ownerQuery,
        input.ownerDraft,
        input.selectedSubject ?? {
          transientName: input.ownerDraft.title ?? input.ownerQuery,
          transientAddress: '',
        },
      );
      if (!query) {
        return failure('invalid_input', 'A public place query is required.');
      }
      const cacheKey = `${endpoint.origin}${endpoint.pathname}\u0000${query}`;
      const cached = await options.cache.get(cacheKey);
      const validatedCache = validateDurableGeocoderProposal(cached);
      if (validatedCache) return { ok: true, value: validatedCache };
      const now = options.clock.now();
      if (!(await options.rateGate.reserve(now))) {
        return failure(
          'dependency_failure',
          'Durable location lookup is temporarily rate limited.',
        );
      }
      const result = await options.transport.search({
        url: `${endpoint.toString()}?format=jsonv2&limit=3&q=${encodeURIComponent(query)}`,
        headers: {
          'User-Agent': identifyingUserAgent,
          Referer: referer,
        },
      });
      if (!result.ok) return result;
      const mapped = mapNominatimResponse(
        result.value,
        endpoint.hostname,
        now.toISOString(),
      );
      if (!mapped) {
        return failure(
          'dependency_failure',
          'Durable location lookup returned an invalid response.',
        );
      }
      await options.cache.set(cacheKey, mapped);
      return { ok: true, value: mapped };
    },
  };
}

export function createInMemoryDurableGeocoderCache(): DurableGeocoderCache {
  const entries = new Map<string, DurableGeocoderProposal>();
  return {
    async get(key) {
      return entries.get(key);
    },
    async set(key, value) {
      entries.set(key, value);
    },
  };
}

export function createNominatimApplicationRateGate(clock: {
  now(): Date;
}): NominatimApplicationRateGate {
  let nextAllowedAt = 0;
  return {
    async reserve(now = clock.now()) {
      if (now.getTime() < nextAllowedAt) return false;
      nextAllowedAt = now.getTime() + 1000;
      return true;
    },
  };
}

function buildQuery(
  ownerQuery: string,
  ownerDraft: {
    readonly title?: string;
    readonly address?: string;
    readonly area?: string;
  },
  selectedSubject: {
    readonly transientName: string;
    readonly transientAddress: string;
  },
): string | undefined {
  // An owner-supplied address is a new, durable lookup input. Keep it separate
  // from the transient discovery label so an unsuccessful branch-name lookup
  // can be recovered without copying provider presentation into storage.
  if (ownerDraft.address) {
    return normalizeText(ownerDraft.address, 1, 500);
  }
  const selected = [
    ownerDraft.title ?? selectedSubject.transientName ?? ownerQuery,
    selectedSubject.transientAddress,
    ownerDraft.area,
  ].filter((value): value is string => Boolean(value));
  return normalizeText(selected.join(' '), 1, 500);
}

function mapNominatimResponse(
  value: unknown,
  provider: string,
  checkedAt: string,
): DurableGeocoderProposal | undefined {
  if (!Array.isArray(value) || value.length > 3) return undefined;
  if (value.length === 0) return { status: 'no_match' };
  if (value.length > 1) return { status: 'ambiguous' };
  const candidate = value[0];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return undefined;
  }
  const record = candidate as Record<string, unknown>;
  const normalizedAddress = normalizeText(record.display_name, 1, 500);
  const latitude = parseCoordinate(record.lat, -90, 90);
  const longitude = parseCoordinate(record.lon, -180, 180);
  const osmType = normalizeOsmType(record.osm_type);
  const osmId = normalizeOsmId(record.osm_id);
  if (
    !normalizedAddress ||
    latitude === undefined ||
    longitude === undefined ||
    !osmType ||
    !osmId
  ) {
    return undefined;
  }
  return {
    status: 'resolved',
    normalizedAddress,
    latitude,
    longitude,
    provider,
    sourceUrl: `https://www.openstreetmap.org/${osmType}/${osmId}`,
    license: 'OpenStreetMap contributors, ODbL 1.0',
    checkedAt,
  };
}

function validateEndpoint(value: string): URL | undefined {
  if (value !== 'https://nominatim.openstreetmap.org/search') {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === '/search'
      ? url
      : undefined;
  } catch {
    return undefined;
  }
}

function validateReferer(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizeText(
  value: unknown,
  minimum: number,
  maximum: number,
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.normalize('NFC').trim();
  return normalized.length >= minimum &&
    normalized.length <= maximum &&
    !/\p{Cc}/u.test(normalized)
    ? normalized
    : undefined;
}

function parseCoordinate(
  value: unknown,
  minimum: number,
  maximum: number,
): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : undefined;
}

function normalizeOsmType(
  value: unknown,
): 'node' | 'way' | 'relation' | undefined {
  const normalized =
    value === 'N'
      ? 'node'
      : value === 'W'
        ? 'way'
        : value === 'R'
          ? 'relation'
          : value;
  return normalized === 'node' ||
    normalized === 'way' ||
    normalized === 'relation'
    ? normalized
    : undefined;
}

function normalizeOsmId(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? String(value)
    : undefined;
}

function hasExactKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function hasAllowedKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return Object.keys(value).every((key) => keys.includes(key));
}
