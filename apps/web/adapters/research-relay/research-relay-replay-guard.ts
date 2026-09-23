export const researchRelayReplaySchemaSql = `
CREATE TABLE IF NOT EXISTS relay_request_claims (
  request_id TEXT PRIMARY KEY NOT NULL,
  allowance_digest TEXT NOT NULL CHECK (length(allowance_digest) = 64),
  expires_at_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_relay_request_claim_expiry
  ON relay_request_claims (expires_at_ms);
`;

export interface RelayReplayGuardPort {
  claim(
    input: unknown,
  ): Promise<
    | { readonly kind: 'claimed' }
    | { readonly kind: 'replay' }
    | { readonly kind: 'conflict' }
    | { readonly kind: 'expired' }
    | { readonly kind: 'invalid' }
  >;
  cleanup(now: Date): Promise<number>;
}

interface RelayReplayDatabase {
  prepare(sql: string): {
    run(...values: readonly unknown[]): { readonly changes: number };
    get(...values: readonly unknown[]): unknown;
  };
}

interface ClaimRow {
  readonly allowance_digest: string;
  readonly expires_at_ms: number;
}

export class SqliteResearchRelayReplayGuard implements RelayReplayGuardPort {
  readonly #database: RelayReplayDatabase;

  constructor(database: RelayReplayDatabase) {
    this.#database = database;
  }

  async claim(input: unknown) {
    const claim = validateClaim(input);
    if (!claim) return { kind: 'invalid' as const };
    const expiresAtMs = Date.parse(claim.expiresAt);
    if (expiresAtMs <= claim.now.getTime()) {
      return { kind: 'expired' as const };
    }
    const inserted = this.#database
      .prepare(
        'INSERT OR IGNORE INTO relay_request_claims ' +
          '(request_id, allowance_digest, expires_at_ms) VALUES (?, ?, ?)',
      )
      .run(claim.requestId, claim.allowanceDigest, expiresAtMs);
    if (inserted.changes === 1) return { kind: 'claimed' as const };
    const existing = this.#database
      .prepare(
        'SELECT allowance_digest, expires_at_ms FROM relay_request_claims ' +
          'WHERE request_id = ?',
      )
      .get(claim.requestId) as ClaimRow | undefined;
    return existing?.allowance_digest === claim.allowanceDigest &&
      existing.expires_at_ms === expiresAtMs
      ? { kind: 'replay' as const }
      : { kind: 'conflict' as const };
  }

  async cleanup(now: Date): Promise<number> {
    return this.#database
      .prepare('DELETE FROM relay_request_claims WHERE expires_at_ms <= ?')
      .run(now.getTime()).changes;
  }
}

interface ValidClaim {
  readonly requestId: string;
  readonly allowanceDigest: string;
  readonly expiresAt: string;
  readonly now: Date;
}

function validateClaim(input: unknown): ValidClaim | null {
  if (!isRecord(input)) return null;
  const keys = Object.keys(input).sort();
  if (
    keys.length !== 4 ||
    keys[0] !== 'allowanceDigest' ||
    keys[1] !== 'expiresAt' ||
    keys[2] !== 'now' ||
    keys[3] !== 'requestId'
  ) {
    return null;
  }
  const { requestId, allowanceDigest, expiresAt, now } = input;
  if (
    typeof requestId !== 'string' ||
    typeof allowanceDigest !== 'string' ||
    typeof expiresAt !== 'string' ||
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime())
  ) {
    return null;
  }
  const expiresAtMs = Date.parse(expiresAt);
  if (
    !isBoundedOpaqueId(requestId) ||
    !/^[0-9a-f]{64}$/u.test(allowanceDigest) ||
    !Number.isFinite(expiresAtMs) ||
    new Date(expiresAtMs).toISOString() !== expiresAt
  ) {
    return null;
  }
  return { requestId, allowanceDigest, expiresAt, now };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedOpaqueId(value: string): boolean {
  return (
    value.length >= 1 && value.length <= 200 && !hasAsciiControlCharacter(value)
  );
}

function hasAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true;
  }
  return false;
}
