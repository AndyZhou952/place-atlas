import { success, type Result } from '../../product/application/result.ts';
import type {
  AgentAuditEvent,
  AgentMutationClaim,
  AgentMutationIdentity,
  AgentMutationSettlement,
  StoredAgentGatewayReceipt,
  AgentAuditSink,
  AgentGatewayState,
  AgentServiceKey,
  AgentServiceKeyStore,
} from '../../product/application/conversation/agent-service-gateway.ts';
import type {
  NearbyRecommendationProvider,
  NearbyRecommendationResult,
} from '../../product/application/conversation/project-command-router.ts';

interface ReceiptRow {
  readonly mutation_id: string;
  readonly payload_digest: string;
  readonly result_json: string;
}

interface NearbyFixtureRow {
  readonly resolved_location: string;
  readonly item_id: string;
  readonly name: string;
  readonly area: string;
  readonly address: string;
  readonly walking_minutes: number;
  readonly visited: number;
  readonly reason: string;
  readonly map_deep_link: string;
}

export class D1AgentGatewayState implements AgentGatewayState {
  readonly #database: D1Database;

  constructor(database: D1Database) {
    this.#database = database;
  }

  async consumeNonce(input: {
    readonly projectId: string;
    readonly keyId: string;
    readonly nonce: string;
    readonly nowMs: number;
    readonly retainUntilMs: number;
  }): Promise<boolean> {
    const result = await this.#database
      .prepare(
        `INSERT INTO agent_gateway_nonces
         (project_id, key_id, nonce, retain_until_ms)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(project_id, key_id, nonce) DO UPDATE SET
           retain_until_ms = excluded.retain_until_ms
         WHERE agent_gateway_nonces.retain_until_ms <= ?`,
      )
      .bind(
        input.projectId,
        input.keyId,
        input.nonce,
        input.retainUntilMs,
        input.nowMs,
      )
      .run();
    return (result.meta.changes ?? 0) === 1;
  }

  async claimMutation(
    input: AgentMutationIdentity,
  ): Promise<AgentMutationClaim> {
    const result = await this.#database
      .prepare(
        `INSERT INTO agent_gateway_receipts
         (project_id, mutation_id, payload_digest, result_json)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(project_id, mutation_id) DO NOTHING`,
      )
      .bind(
        input.projectId,
        input.mutationId,
        input.payloadDigest,
        mutationClaimJson(input.claimId),
      )
      .run();
    if ((result.meta.changes ?? 0) === 1) return { kind: 'claimed' };
    return this.#readMutation(input);
  }

  async waitForMutation(
    input: Omit<AgentMutationIdentity, 'claimId'>,
  ): Promise<AgentMutationSettlement> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const outcome = await this.#readMutation(input);
      if (outcome.kind !== 'pending') return outcome;
      await delay(25);
    }
    return { kind: 'unavailable' };
  }

  async commitMutation(input: {
    readonly identity: AgentMutationIdentity;
    readonly receipt: StoredAgentGatewayReceipt;
  }): Promise<StoredAgentGatewayReceipt> {
    const resultJson = JSON.stringify(input.receipt.result);
    const result = await this.#database
      .prepare(
        `UPDATE agent_gateway_receipts
         SET result_json = ?
         WHERE project_id = ? AND mutation_id = ? AND payload_digest = ?
           AND result_json = ?`,
      )
      .bind(
        resultJson,
        input.identity.projectId,
        input.identity.mutationId,
        input.identity.payloadDigest,
        mutationClaimJson(input.identity.claimId),
      )
      .run();
    if ((result.meta.changes ?? 0) === 1) return input.receipt;

    const outcome = await this.#readMutation(input.identity);
    if (outcome.kind === 'replay') return outcome.receipt;
    throw new Error('Agent mutation claim was lost before commit.');
  }

  async releaseMutation(input: AgentMutationIdentity): Promise<void> {
    await this.#database
      .prepare(
        `DELETE FROM agent_gateway_receipts
         WHERE project_id = ? AND mutation_id = ? AND payload_digest = ?
           AND result_json = ?`,
      )
      .bind(
        input.projectId,
        input.mutationId,
        input.payloadDigest,
        mutationClaimJson(input.claimId),
      )
      .run();
  }

  async #readMutation(input: {
    readonly projectId: string;
    readonly mutationId: string;
    readonly payloadDigest: string;
  }): Promise<Exclude<AgentMutationClaim, { readonly kind: 'claimed' }>> {
    const row = await this.#database
      .prepare(
        `SELECT mutation_id, payload_digest, result_json
         FROM agent_gateway_receipts
         WHERE project_id = ? AND mutation_id = ?`,
      )
      .bind(input.projectId, input.mutationId)
      .first<ReceiptRow>();
    if (!row) return { kind: 'pending' };
    if (row.payload_digest !== input.payloadDigest) {
      return { kind: 'conflict' };
    }
    return parseMutationRow(row);
  }
}

function mutationClaimJson(claimId: string): string {
  return JSON.stringify({ state: 'claimed', claimId });
}

function parseMutationRow(
  row: ReceiptRow,
): Exclude<AgentMutationClaim, { readonly kind: 'claimed' | 'conflict' }> {
  const result = JSON.parse(row.result_json) as unknown;
  if (
    result !== null &&
    typeof result === 'object' &&
    !Array.isArray(result) &&
    (result as { readonly state?: unknown }).state === 'claimed'
  ) {
    return { kind: 'pending' };
  }
  if (
    result === null ||
    typeof result !== 'object' ||
    Array.isArray(result) ||
    (result as { readonly projectId?: unknown }).projectId !== 'jpmap' ||
    (result as { readonly operation?: unknown }).operation !== 'nearby' ||
    typeof (result as { readonly replyText?: unknown }).replyText !== 'string'
  ) {
    throw new Error('Stored Agent receipt is invalid.');
  }
  return {
    kind: 'replay',
    receipt: {
      mutationId: row.mutation_id,
      payloadDigest: row.payload_digest,
      result: result as StoredAgentGatewayReceipt['result'],
    },
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class D1AgentAuditSink implements AgentAuditSink {
  readonly #database: D1Database;
  readonly #nowMs: () => number;

  constructor(database: D1Database, nowMs: () => number) {
    this.#database = database;
    this.#nowMs = nowMs;
  }

  async record(event: AgentAuditEvent): Promise<void> {
    await this.#database
      .prepare(
        `INSERT INTO agent_gateway_audit
         (project_id, key_id, actor_id, channel, conversation_id, operation,
          mutation_id, result_kind, replayed, duration_ms, created_at_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        event.projectId,
        event.keyId,
        event.actorId,
        event.channel,
        event.conversationId,
        event.operation,
        event.mutationId,
        event.resultKind,
        event.replayed ? 1 : 0,
        event.durationMs,
        this.#nowMs(),
      )
      .run();
  }
}

export class D1NearbyFixtureProvider implements NearbyRecommendationProvider {
  readonly #database: D1Database;

  constructor(database: D1Database) {
    this.#database = database;
  }

  async recommend(input: {
    readonly locationHint: string;
  }): Promise<Result<NearbyRecommendationResult>> {
    const result = await this.#database
      .prepare(
        `SELECT resolved_location, item_id, name, area, address,
                walking_minutes, visited, reason, map_deep_link
         FROM agent_nearby_fixtures
         WHERE fixture_set = ?
         ORDER BY fixture_rank ASC`,
      )
      .bind('readonly-default')
      .all<NearbyFixtureRow>();
    return success({
      requestedLocation: input.locationHint,
      resolvedLocation:
        result.results[0]?.resolved_location ?? input.locationHint,
      recommendations: result.results.map((row) => ({
        itemId: row.item_id,
        name: row.name,
        area: row.area,
        address: row.address,
        walkingMinutes: row.walking_minutes,
        visited: Boolean(row.visited),
        reason: row.reason,
        mapDeepLink: row.map_deep_link,
      })),
    });
  }
}

export function createFixtureAgentKeyStore(input: {
  readonly keyId: string;
  readonly secret: string;
  readonly actorId: string;
  readonly conversationId: string;
}): AgentServiceKeyStore {
  const key: AgentServiceKey = {
    keyId: input.keyId,
    projectId: 'jpmap',
    secret: input.secret,
    active: true,
    owner: {
      actorId: input.actorId,
      channel: 'openclaw-weixin',
      conversationId: input.conversationId,
      conversationType: 'direct',
    },
    scopes: ['atlas:nearby:read'],
  };
  return {
    async find(keyId) {
      return keyId === key.keyId ? key : undefined;
    },
  };
}
