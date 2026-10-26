// OpenStreetMap Nominatim confirms coordinates for an Add preview. Its usage policy asks for an
// identifying User-Agent, at most one request per second and caching, so requests share one D1
// rate gate and a 30-day D1 cache.
import type { DurableGeocoderPort, DurableGeocoderProposal } from '../add/coordinator.ts';
import { validateDurableGeocoderProposal } from '../add/coordinator.ts';
import { failure, type Result } from '../../../shared/result.ts';
import { fetchBoundedJson } from './quota.ts';

const endpoint = 'https://nominatim.openstreetmap.org/search';
const providerId = 'nominatim.openstreetmap.org';
const cacheTtlMs = 30 * 24 * 60 * 60 * 1000;
const project = 'https://github.com/AndyZhou952/place-atlas';

/** Nominatim asks for an identifying contact; a clean https origin of this deployment is used. */
export function nominatimIdentity(publicUrl?: string) {
  const fallback = {
    identifyingUserAgent: `JapanAtlas/0.1.0 (+${project})`,
    referer: project,
  };
  try {
    const url = new URL(publicUrl ?? '');
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.port ||
      url.pathname !== '/'
    )
      return fallback;
    return {
      identifyingUserAgent: `JapanAtlas/0.1.0 (+${url.origin}/terms)`,
      referer: `${url.origin}/`,
    };
  } catch {
    return fallback;
  }
}

interface NominatimTransport {
  search(request: {
    readonly url: string;
    readonly headers: { readonly 'User-Agent': string; readonly Referer: string };
  }): Promise<Result<unknown>>;
}

export interface DurableGeocoderCache {
  get(key: string): Promise<DurableGeocoderProposal | undefined>;
  set(key: string, value: DurableGeocoderProposal): Promise<void>;
}

export interface NominatimApplicationRateGate {
  reserve(now: Date): Promise<boolean>;
}

export function createNominatimDurableGeocoderAdapter(options: {
  readonly identifyingUserAgent: string;
  readonly referer: string;
  readonly transport: NominatimTransport;
  readonly cache: DurableGeocoderCache;
  readonly rateGate: NominatimApplicationRateGate;
  readonly clock: { now(): Date };
}): DurableGeocoderPort {
  const userAgent = normalizeText(options.identifyingUserAgent, 10, 300);
  return {
    async propose({ ownerQuery, ownerDraft, selectedSubject }) {
      if (!userAgent)
        return failure('dependency_failure', 'Durable location lookup is not configured.');
      // An Owner-supplied address is a new lookup input; otherwise the selected place's name,
      // address and area are combined. The provider's own text is never stored.
      const query = ownerDraft.address
        ? normalizeText(ownerDraft.address, 1, 500)
        : normalizeText(
            [
              ownerDraft.title ?? selectedSubject?.transientName ?? ownerQuery,
              selectedSubject?.transientAddress,
              ownerDraft.area,
            ]
              .filter(Boolean)
              .join(' '),
            1,
            500,
          );
      if (!query) return failure('invalid_input', 'A public place query is required.');
      const cacheKey = `${endpoint}\u0000${query}`;
      const cached = validateDurableGeocoderProposal(await options.cache.get(cacheKey));
      if (cached) return { ok: true, value: cached };
      const now = options.clock.now();
      if (!(await options.rateGate.reserve(now)))
        return failure(
          'dependency_failure',
          'Durable location lookup is temporarily rate limited.',
        );
      const result = await options.transport.search({
        url: `${endpoint}?format=jsonv2&limit=3&q=${encodeURIComponent(query)}`,
        headers: { 'User-Agent': userAgent, Referer: options.referer },
      });
      if (!result.ok) return result;
      const mapped = mapNominatimResponse(result.value, now.toISOString());
      if (!mapped)
        return failure(
          'dependency_failure',
          'Durable location lookup returned an invalid response.',
        );
      await options.cache.set(cacheKey, mapped);
      return { ok: true, value: mapped };
    },
  };
}

export function createNominatimFixedEndpointTransport(options: {
  readonly fetch?: typeof fetch;
}): NominatimTransport {
  return {
    async search(request) {
      if (!request.url.startsWith(`${endpoint}?`))
        return failure('dependency_failure', 'Durable location lookup is unavailable.');
      const response = await fetchBoundedJson(
        request.url,
        { method: 'GET', headers: request.headers },
        { fetch: options.fetch ?? fetch, timeoutMs: 8_000, maximumBytes: 64 * 1024 },
      );
      return response.ok
        ? { ok: true, value: response.value }
        : failure('dependency_failure', 'Durable location lookup is unavailable.');
    },
  };
}

/** The shared rate gate and cache in D1. */
export class D1NominatimPolicyState implements DurableGeocoderCache, NominatimApplicationRateGate {
  readonly #database: D1Database;
  readonly #clock: { now(): Date };

  constructor(database: D1Database, clock: { now(): Date }) {
    this.#database = database;
    this.#clock = clock;
  }

  async reserve(now: Date): Promise<boolean> {
    const nowMs = now.getTime();
    const result = await this.#database
      .prepare(
        `INSERT INTO catalog_intake_nominatim_rate_gate (provider_id, next_allowed_at_ms)
         VALUES (?, ?) ON CONFLICT(provider_id) DO UPDATE SET
           next_allowed_at_ms = excluded.next_allowed_at_ms
         WHERE catalog_intake_nominatim_rate_gate.next_allowed_at_ms <= ?`,
      )
      .bind(providerId, nowMs + 1000, nowMs)
      .run();
    return Number(result.meta?.changes ?? 0) === 1;
  }

  async get(key: string): Promise<DurableGeocoderProposal | undefined> {
    const row = await this.#database
      .prepare(
        `SELECT result_json, cached_at_ms FROM catalog_intake_nominatim_cache
         WHERE provider_id = ? AND query_key = ?`,
      )
      .bind(providerId, key)
      .first<{ result_json: string; cached_at_ms: number }>();
    if (!row || row.cached_at_ms + cacheTtlMs <= this.#clock.now().getTime()) return undefined;
    try {
      return validateDurableGeocoderProposal(JSON.parse(row.result_json));
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: DurableGeocoderProposal): Promise<void> {
    const validated = validateDurableGeocoderProposal(value);
    if (!validated) throw new TypeError('Invalid Nominatim cache proposal.');
    await this.#database
      .prepare(
        `INSERT INTO catalog_intake_nominatim_cache (provider_id, query_key, result_json, cached_at_ms)
         VALUES (?, ?, ?, ?) ON CONFLICT(provider_id, query_key) DO UPDATE SET
           result_json = excluded.result_json, cached_at_ms = excluded.cached_at_ms`,
      )
      .bind(providerId, key, JSON.stringify(validated), this.#clock.now().getTime())
      .run();
  }

  async cleanup(now: Date): Promise<number> {
    const result = await this.#database
      .prepare('DELETE FROM catalog_intake_nominatim_cache WHERE cached_at_ms <= ?')
      .bind(now.getTime() - cacheTtlMs)
      .run();
    return Number(result.meta?.changes ?? 0);
  }
}

function mapNominatimResponse(
  value: unknown,
  checkedAt: string,
): DurableGeocoderProposal | undefined {
  if (!Array.isArray(value) || value.length > 3) return undefined;
  if (value.length === 0) return { status: 'no_match' };
  if (value.length > 1) return { status: 'ambiguous' };
  const record = value[0];
  if (!record || typeof record !== 'object' || Array.isArray(record)) return undefined;
  const normalizedAddress = normalizeText(record.display_name, 1, 500);
  const latitude = parseCoordinate(record.lat, 90);
  const longitude = parseCoordinate(record.lon, 180);
  const osmType =
    { N: 'node', W: 'way', R: 'relation' }[record.osm_type as string] ?? record.osm_type;
  const osmId = record.osm_id;
  if (
    !normalizedAddress ||
    latitude === undefined ||
    longitude === undefined ||
    !['node', 'way', 'relation'].includes(osmType) ||
    !(typeof osmId === 'number' && Number.isSafeInteger(osmId) && osmId > 0)
  )
    return undefined;
  return {
    status: 'resolved',
    normalizedAddress,
    latitude,
    longitude,
    provider: providerId,
    sourceUrl: `https://www.openstreetmap.org/${osmType}/${osmId}`,
    license: 'OpenStreetMap contributors, ODbL 1.0',
    checkedAt,
  };
}

function normalizeText(value: unknown, minimum: number, maximum: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.normalize('NFC').trim();
  return normalized.length >= minimum && normalized.length <= maximum && !/\p{Cc}/u.test(normalized)
    ? normalized
    : undefined;
}

function parseCoordinate(value: unknown, limit: number): number | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.abs(parsed) <= limit ? parsed : undefined;
}
