import type { AtomicMutationCommit } from '@/product/application/atlas-application';
import type {
  MutationAttempt,
  MutationClaim,
  MutationReceiptState,
  StoredMutationReceipt,
} from '@/product/application/invocation/invocation-coordinator';

interface ClaimRow {
  readonly payload_digest: string;
  readonly attempt_token: string;
  readonly lease_until_ms: number;
  readonly state: 'claimed' | 'committed';
}

interface ReceiptRow {
  readonly mutation_id: string;
  readonly payload_digest: string;
  readonly result_json: string;
}

export class D1MutationReceiptState implements MutationReceiptState {
  readonly #database: D1Database;

  constructor(database: D1Database) {
    this.#database = database;
  }

  async claim(input: MutationAttempt): Promise<MutationClaim> {
    const result = await this.#database
      .prepare(
        `INSERT INTO atlas_mutation_claims
         (principal, mutation_id, payload_digest, attempt_token,
          lease_until_ms, state, created_at_ms, updated_at_ms)
         VALUES (?, ?, ?, ?, ?, 'claimed', ?, ?)
         ON CONFLICT(principal, mutation_id) DO UPDATE SET
           attempt_token = excluded.attempt_token,
           lease_until_ms = excluded.lease_until_ms,
           updated_at_ms = excluded.updated_at_ms
         WHERE atlas_mutation_claims.payload_digest = excluded.payload_digest
           AND atlas_mutation_claims.state = 'claimed'
           AND atlas_mutation_claims.lease_until_ms <= excluded.created_at_ms
           AND NOT EXISTS (
             SELECT 1 FROM atlas_mutation_receipts AS receipts
             WHERE receipts.principal = excluded.principal
               AND receipts.mutation_id = excluded.mutation_id
           )`,
      )
      .bind(
        input.principal,
        input.mutationId,
        input.payloadDigest,
        input.attemptToken,
        input.leaseUntilMs,
        input.nowMs,
        input.nowMs,
      )
      .run();
    if ((result.meta.changes ?? 0) === 1) return { kind: 'claimed' };
    return this.#readOutcome(input);
  }

  async readFinal(input: {
    readonly principal: string;
    readonly mutationId: string;
    readonly payloadDigest: string;
  }) {
    return this.#readOutcome(input);
  }

  async release(input: MutationAttempt): Promise<void> {
    await this.#database
      .prepare(
        `DELETE FROM atlas_mutation_claims
         WHERE principal = ? AND mutation_id = ? AND payload_digest = ?
           AND attempt_token = ? AND state = 'claimed'`,
      )
      .bind(
        input.principal,
        input.mutationId,
        input.payloadDigest,
        input.attemptToken,
      )
      .run();
  }

  async #readOutcome(input: {
    readonly principal: string;
    readonly mutationId: string;
    readonly payloadDigest: string;
  }): Promise<Exclude<MutationClaim, { readonly kind: 'claimed' }>> {
    const receipt = await this.#database
      .prepare(
        `SELECT mutation_id, payload_digest, result_json
         FROM atlas_mutation_receipts
         WHERE principal = ? AND mutation_id = ?`,
      )
      .bind(input.principal, input.mutationId)
      .first<ReceiptRow>();
    if (receipt) {
      return receipt.payload_digest === input.payloadDigest
        ? { kind: 'replay', receipt: parseReceipt(receipt) }
        : { kind: 'conflict' };
    }
    const claim = await this.#database
      .prepare(
        `SELECT payload_digest, attempt_token, lease_until_ms, state
         FROM atlas_mutation_claims
         WHERE principal = ? AND mutation_id = ?`,
      )
      .bind(input.principal, input.mutationId)
      .first<ClaimRow>();
    if (!claim) return { kind: 'pending' };
    return claim.payload_digest === input.payloadDigest
      ? { kind: 'pending' }
      : { kind: 'conflict' };
  }
}

/**
 * Appends the final receipt to the same D1 batch as the business statements.
 * The guarded INSERT deliberately attempts a NOT NULL-violating row when the
 * exact active attempt is absent, forcing D1 to roll the whole batch back.
 */
export function commitD1MutationAtomically(
  database: D1Database,
  businessStatements: readonly D1PreparedStatement[],
  commit?: AtomicMutationCommit,
): Promise<readonly D1Result[]> {
  if (!commit) return database.batch([...businessStatements]);
  const guard = exactAttemptPredicate;
  return database.batch([
    ...businessStatements,
    database
      .prepare(
        `INSERT INTO atlas_mutation_receipts
         (principal, mutation_id, payload_digest, result_json, committed_at_ms)
         SELECT ?, ?, ?, ?, ?
         WHERE EXISTS (${guard})
         UNION ALL
         SELECT NULL, NULL, NULL, NULL, NULL
         WHERE NOT EXISTS (${guard})`,
      )
      .bind(...finalizeBindings(commit), ...attemptBindings(commit)),
    database
      .prepare(
        `UPDATE atlas_mutation_claims
         SET state = 'committed', updated_at_ms = ?
         WHERE principal = ? AND mutation_id = ? AND payload_digest = ?
           AND attempt_token = ? AND state = 'claimed'`,
      )
      .bind(
        commit.committedAtMs,
        commit.principal,
        commit.mutationId,
        commit.payloadDigest,
        commit.attemptToken,
      ),
  ]);
}

const exactAttemptPredicate = `SELECT 1 FROM atlas_mutation_claims
  WHERE principal = ? AND mutation_id = ? AND payload_digest = ?
    AND attempt_token = ? AND state = 'claimed'`;

function finalizeBindings(commit: AtomicMutationCommit): readonly unknown[] {
  return [
    commit.principal,
    commit.mutationId,
    commit.payloadDigest,
    JSON.stringify(commit.result),
    commit.committedAtMs,
  ];
}

function attemptBindings(commit: AtomicMutationCommit): readonly unknown[] {
  return [
    commit.principal,
    commit.mutationId,
    commit.payloadDigest,
    commit.attemptToken,
    commit.principal,
    commit.mutationId,
    commit.payloadDigest,
    commit.attemptToken,
  ];
}

function parseReceipt(row: ReceiptRow): StoredMutationReceipt {
  return {
    mutationId: row.mutation_id,
    payloadDigest: row.payload_digest,
    result: JSON.parse(row.result_json) as unknown,
  };
}
