import {
  type DurableGeocoderProposal,
  validateDurableGeocoderProposal,
} from '../../../product/application/catalog-intake/catalog-intake-coordinator.ts';

interface CacheRow {
  readonly result_json: string;
}

export class D1NominatimPolicyState {
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
        'INSERT INTO catalog_intake_nominatim_rate_gate ' +
          '(provider_id, next_allowed_at_ms) VALUES (?, ?) ' +
          'ON CONFLICT(provider_id) DO UPDATE SET ' +
          'next_allowed_at_ms = excluded.next_allowed_at_ms ' +
          'WHERE catalog_intake_nominatim_rate_gate.next_allowed_at_ms <= ?',
      )
      .bind(providerId, nowMs + 1000, nowMs)
      .run();
    return Number(result.meta?.changes ?? 0) === 1;
  }

  async get(key: string): Promise<DurableGeocoderProposal | undefined> {
    const row = await this.#database
      .prepare(
        'SELECT result_json FROM catalog_intake_nominatim_cache ' +
          'WHERE provider_id = ? AND query_key = ?',
      )
      .bind(providerId, key)
      .first<CacheRow>();
    if (!row) return undefined;
    try {
      return validateDurableGeocoderProposal(JSON.parse(row.result_json));
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: DurableGeocoderProposal): Promise<void> {
    const validated = validateDurableGeocoderProposal(value);
    if (!validated) {
      throw new TypeError('Invalid Nominatim cache proposal.');
    }
    await this.#database
      .prepare(
        'INSERT INTO catalog_intake_nominatim_cache ' +
          '(provider_id, query_key, result_json, cached_at_ms) ' +
          'VALUES (?, ?, ?, ?) ON CONFLICT(provider_id, query_key) DO UPDATE SET ' +
          'result_json = excluded.result_json, cached_at_ms = excluded.cached_at_ms',
      )
      .bind(
        providerId,
        key,
        JSON.stringify(validated),
        this.#clock.now().getTime(),
      )
      .run();
  }
}

const providerId = 'nominatim.openstreetmap.org';
