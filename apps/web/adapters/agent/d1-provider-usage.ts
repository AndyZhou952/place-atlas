import type { ProviderUsagePort } from '../../product/provider-policy/provider-policy-gateway.ts';

export class D1ProviderUsage implements ProviderUsagePort {
  private readonly database: D1Database;
  private readonly now: () => Date;

  constructor(database: D1Database, now: () => Date) {
    this.database = database;
    this.now = now;
  }

  async reserve(reservation: {
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
