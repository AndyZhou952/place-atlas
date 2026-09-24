import type { ProviderUsagePort } from '../../product/provider-policy/provider-policy-gateway.ts';

export type ProviderUsageSku =
  | 'geocoding.requests'
  | 'walking_matrix.elements'
  | 'places.search_text.requests'
  | 'places.details.requests';

export class D1ProviderUsage implements ProviderUsagePort {
  private readonly database: D1Database;
  private readonly now: () => Date;

  constructor(database: D1Database, now: () => Date) {
    this.database = database;
    this.now = now;
  }

  async reserve(reservation: {
    readonly providerId: string;
    readonly sku?: ProviderUsageSku;
    readonly units?: number;
    readonly requests: 1;
    readonly costUsd: number;
    readonly hardRequestLimit: number;
    readonly hardUnitLimit?: number;
    readonly hardCostLimitUsd: number;
  }): Promise<'reserved' | 'quota_exceeded' | 'cost_exceeded'> {
    if (
      reservation.sku !== undefined ||
      reservation.units !== undefined ||
      reservation.hardUnitLimit !== undefined
    ) {
      return this.#reserveSkuUnits(reservation);
    }
    return this.#reserveLegacy(reservation);
  }

  async #reserveLegacy(reservation: {
    readonly providerId: string;
    readonly requests: 1;
    readonly costUsd: number;
    readonly hardRequestLimit: number;
    readonly hardCostLimitUsd: number;
  }): Promise<'reserved' | 'quota_exceeded' | 'cost_exceeded'> {
    const cost = toMicroUsd(reservation.costUsd);
    const hardCost = toMicroUsd(reservation.hardCostLimitUsd);
    if (
      cost === undefined ||
      hardCost === undefined ||
      !Number.isSafeInteger(reservation.hardRequestLimit) ||
      reservation.hardRequestLimit < 1
    )
      return 'cost_exceeded';
    const period = monthStart(this.now());
    try {
      const result = await this.database
        .prepare(
          `INSERT INTO agent_provider_usage (
          provider_id, period_start_utc, request_count, cost_micro_usd
        ) VALUES (?, ?, 1, ?)
        ON CONFLICT(provider_id, period_start_utc) DO UPDATE SET
          request_count = request_count + 1,
          cost_micro_usd = cost_micro_usd + excluded.cost_micro_usd
        WHERE request_count + 1 <= ?
          AND cost_micro_usd + excluded.cost_micro_usd <= ?`,
        )
        .bind(
          reservation.providerId,
          period,
          cost,
          reservation.hardRequestLimit,
          hardCost,
        )
        .run();
      if (result.meta.changes === 1) return 'reserved';
      const current = await this.database
        .prepare(
          `SELECT request_count, cost_micro_usd
         FROM agent_provider_usage
         WHERE provider_id = ? AND period_start_utc = ?`,
        )
        .bind(reservation.providerId, period)
        .first<{ request_count: number; cost_micro_usd: number }>();
      return current && current.request_count >= reservation.hardRequestLimit
        ? 'quota_exceeded'
        : 'cost_exceeded';
    } catch {
      return 'cost_exceeded';
    }
  }

  async #reserveSkuUnits(reservation: {
    readonly providerId: string;
    readonly sku?: ProviderUsageSku;
    readonly units?: number;
    readonly requests: 1;
    readonly costUsd: number;
    readonly hardRequestLimit: number;
    readonly hardUnitLimit?: number;
    readonly hardCostLimitUsd: number;
  }): Promise<'reserved' | 'quota_exceeded' | 'cost_exceeded'> {
    const cost = toMicroUsd(reservation.costUsd);
    const hardCost = toMicroUsd(reservation.hardCostLimitUsd);
    if (
      cost === undefined ||
      hardCost === undefined ||
      reservation.sku === undefined ||
      !Number.isSafeInteger(reservation.units) ||
      reservation.units === undefined ||
      reservation.units < 1 ||
      !Number.isSafeInteger(reservation.hardRequestLimit) ||
      reservation.hardRequestLimit < 1 ||
      !Number.isSafeInteger(reservation.hardUnitLimit) ||
      reservation.hardUnitLimit === undefined ||
      reservation.hardUnitLimit < 1 ||
      (reservation.sku !== 'walking_matrix.elements' && reservation.units !== 1)
    ) {
      return 'cost_exceeded';
    }
    const period = monthStart(this.now());
    try {
      const result = await this.database
        .prepare(
          `INSERT INTO agent_provider_usage_by_sku (
             provider_id, sku, period_start_utc, request_count,
             billable_units, cost_micro_usd
           ) VALUES (?, ?, ?, 1, ?, ?)
           ON CONFLICT(provider_id, sku, period_start_utc) DO UPDATE SET
             request_count = request_count + 1,
             billable_units = billable_units + excluded.billable_units,
             cost_micro_usd = cost_micro_usd + excluded.cost_micro_usd
           WHERE request_count + 1 <= ?
             AND billable_units + excluded.billable_units <= ?
             AND cost_micro_usd + excluded.cost_micro_usd <= ?`,
        )
        .bind(
          reservation.providerId,
          reservation.sku,
          period,
          reservation.units,
          cost,
          reservation.hardRequestLimit,
          reservation.hardUnitLimit,
          hardCost,
        )
        .run();
      if (result.meta.changes === 1) return 'reserved';
      const current = await this.database
        .prepare(
          `SELECT request_count, billable_units, cost_micro_usd
           FROM agent_provider_usage_by_sku
           WHERE provider_id = ? AND sku = ? AND period_start_utc = ?`,
        )
        .bind(reservation.providerId, reservation.sku, period)
        .first<{
          request_count: number;
          billable_units: number;
          cost_micro_usd: number;
        }>();
      return current &&
        (current.request_count + 1 > reservation.hardRequestLimit ||
          current.billable_units + reservation.units >
            reservation.hardUnitLimit)
        ? 'quota_exceeded'
        : 'cost_exceeded';
    } catch {
      return 'cost_exceeded';
    }
  }
}

function monthStart(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01T00:00:00.000Z`;
}

function toMicroUsd(value: number): number | undefined {
  const scaled = Math.round(value * 1_000_000);
  return Number.isFinite(value) && value >= 0 && Number.isSafeInteger(scaled)
    ? scaled
    : undefined;
}
