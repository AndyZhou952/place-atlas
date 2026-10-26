// Provider quotas and bounded provider reads. Every paid call first reserves one request (and its
// billable units and cost) against this month's cap in D1; the reservation is atomic, so
// concurrent requests can never cross a cap.

export type ProviderUsageSku =
  | 'geocoding.requests'
  | 'walking_matrix.elements'
  | 'transit_routes.requests'
  | 'places.search_text.requests'
  | 'places.details.requests'
  | 'places.details_rating.requests';

export interface UsageReservation {
  readonly providerId: string;
  readonly sku: ProviderUsageSku;
  /** Billable units: one per request, or one per destination for walking matrices. */
  readonly units: number;
  readonly requests: 1;
  readonly costUsd: number;
  readonly hardRequestLimit: number;
  readonly hardUnitLimit: number;
  readonly hardCostLimitUsd: number;
}

export class D1ProviderUsage {
  private readonly database: D1Database;
  private readonly now: () => Date;

  constructor(database: D1Database, now: () => Date) {
    this.database = database;
    this.now = now;
  }

  async reserve(
    reservation: UsageReservation,
  ): Promise<'reserved' | 'quota_exceeded' | 'cost_exceeded'> {
    const cost = toMicroUsd(reservation.costUsd);
    const hardCost = toMicroUsd(reservation.hardCostLimitUsd);
    if (
      cost === undefined ||
      hardCost === undefined ||
      !positiveInteger(reservation.units) ||
      !positiveInteger(reservation.hardRequestLimit) ||
      !positiveInteger(reservation.hardUnitLimit) ||
      (reservation.sku !== 'walking_matrix.elements' && reservation.units !== 1)
    )
      return 'cost_exceeded';
    const period = monthStart(this.now());
    try {
      const result = await this.database
        .prepare(
          `INSERT INTO agent_provider_usage_by_sku (
             provider_id, sku, period_start_utc, request_count, billable_units, cost_micro_usd
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
          `SELECT request_count, billable_units FROM agent_provider_usage_by_sku
           WHERE provider_id = ? AND sku = ? AND period_start_utc = ?`,
        )
        .bind(reservation.providerId, reservation.sku, period)
        .first<{ request_count: number; billable_units: number }>();
      return current &&
        (current.request_count + 1 > reservation.hardRequestLimit ||
          current.billable_units + reservation.units > reservation.hardUnitLimit)
        ? 'quota_exceeded'
        : 'cost_exceeded';
    } catch {
      return 'cost_exceeded';
    }
  }
}

const positiveInteger = (value: number) => Number.isSafeInteger(value) && value >= 1;

function monthStart(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01T00:00:00.000Z`;
}

function toMicroUsd(value: number): number | undefined {
  const scaled = Math.round(value * 1_000_000);
  return Number.isFinite(value) && value >= 0 && Number.isSafeInteger(scaled) ? scaled : undefined;
}

/** A JSON provider response, refused when it redirects, times out or exceeds `maximumBytes`. */
export async function fetchBoundedJson(
  url: string,
  init: RequestInit,
  options: {
    readonly fetch: typeof fetch;
    readonly timeoutMs: number;
    readonly maximumBytes: number;
  },
): Promise<{ readonly ok: true; readonly value: unknown } | { readonly ok: false }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await options.fetch(url, {
      ...init,
      redirect: 'manual',
      signal: controller.signal,
    });
    if (!response.ok || response.status >= 300 || !response.body) return { ok: false };
    const declaredLength = response.headers.get('content-length');
    if (
      declaredLength !== null &&
      (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > options.maximumBytes)
    )
      return { ok: false };
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > options.maximumBytes) {
        await reader.cancel();
        return { ok: false };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timeout);
  }
}
