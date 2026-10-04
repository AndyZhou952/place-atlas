import type {
  CatalogIntakeCandidatesSession,
  CatalogIntakeResearchAllowance,
  CatalogIntakeSelectedSubject,
  CatalogIntakeScope,
  CatalogIntakeStatePort,
  CatalogIntakeStoredSession,
} from '../../../product/application/catalog-intake/catalog-intake-coordinator.ts';
import { catalogIntakeResearchBudgets } from '../../../product/application/catalog-intake/catalog-intake-coordinator.ts';
import { hasCanonicalCatalogIntakeWarningOrder } from '../../../product/application/catalog-intake/catalog-intake-warning-policy.ts';

interface JsonRow {
  readonly value_json: string;
}

interface RequestRow {
  readonly normalized_owner_query: string;
  readonly session_id: string;
}

interface ResearchSpendRow {
  readonly deadline_ms: number;
}

interface ResearchEligibilityRow {
  readonly state: string;
  readonly session_version: number;
  readonly expires_at_ms: number;
  readonly research_digest: string | null;
}

export class D1CatalogIntakeState implements CatalogIntakeStatePort {
  readonly #database: D1Database;
  readonly #clock: { now(): Date };

  constructor(
    database: D1Database,
    clock: { now(): Date } = { now: () => new Date() },
  ) {
    this.#database = database;
    this.#clock = clock;
  }

  async findByRequest(scope: CatalogIntakeScope, requestToken: string) {
    const row = await this.#database
      .prepare(findRequestSql)
      .bind(scope.ownerId, scope.channel, scope.conversationId, requestToken)
      .first<RequestRow>();
    return row ? this.get(scope, row.session_id) : undefined;
  }

  async createReplacingActive(session: CatalogIntakeCandidatesSession) {
    const prior = await this.findByRequest(session, session.requestToken);
    if (prior) return replayOrConflict(prior, session.normalizedOwnerQuery);
    const createdAtMs = Date.parse(session.createdAt);
    const retainUntilMs = createdAtMs + retentionMs;
    try {
      await this.#database.batch([
        this.#database
          .prepare(insertTokenSql)
          .bind(
            session.ownerId,
            session.channel,
            session.conversationId,
            session.requestToken,
            session.normalizedOwnerQuery,
            session.sessionId,
            retainUntilMs,
          ),
        this.#database
          .prepare(replaceTerminalSql)
          .bind(
            createdAtMs,
            retainUntilMs,
            session.createdAt,
            new Date(retainUntilMs).toISOString(),
            session.ownerId,
            session.channel,
            session.conversationId,
          ),
        this.#database
          .prepare(deleteActiveScopeSql)
          .bind(session.ownerId, session.channel, session.conversationId),
        insertSession(this.#database, session),
      ]);
      return { kind: 'created' as const, session };
    } catch (error) {
      const raced = await this.findByRequest(session, session.requestToken);
      if (raced) return replayOrConflict(raced, session.normalizedOwnerQuery);
      throw error;
    }
  }

  async get(scope: CatalogIntakeScope, sessionId: string) {
    const active = await this.#database
      .prepare(findActiveSql)
      .bind(sessionId, scope.ownerId, scope.channel, scope.conversationId)
      .first<JsonRow>();
    if (active) return parseStored(active.value_json);
    const terminal = await this.#database
      .prepare(findTerminalSql)
      .bind(
        sessionId,
        scope.ownerId,
        scope.channel,
        scope.conversationId,
        this.#clock.now().getTime(),
      )
      .first<JsonRow>();
    return terminal ? parseStored(terminal.value_json) : undefined;
  }

  async compareAndSwap(input: {
    readonly scope: CatalogIntakeScope;
    readonly sessionId: string;
    readonly expectedVersion: number;
    readonly next: CatalogIntakeStoredSession;
  }) {
    const { scope, sessionId, expectedVersion, next } = input;
    if (next.state === 'candidates_ready' || next.state === 'preview_ready') {
      const nowMs = this.#clock.now().getTime();
      const result = await this.#database
        .prepare(updateActiveSql)
        .bind(
          next.state,
          next.sessionVersion,
          JSON.stringify(next),
          Date.parse(next.lastAcceptedActivityAt),
          Date.parse(next.expiresAt),
          Date.parse(next.lastAcceptedActivityAt),
          sessionId,
          scope.ownerId,
          scope.channel,
          scope.conversationId,
          expectedVersion,
          nowMs,
        )
        .run();
      if (changes(result) === 1) {
        return { kind: 'applied' as const, session: next };
      }
      const current = await this.get(scope, sessionId);
      return {
        kind: 'conflict' as const,
        ...(current ? { current } : {}),
      };
    }
    if (next.state === 'committed') {
      throw new Error(
        'Committed intake sessions are written only by Atlas Catalog publish.',
      );
    }

    const sourceVersion =
      next.state === 'cancelled'
        ? next.cancelledFromVersion
        : next.expiredFromVersion;
    const terminalAt =
      next.state === 'cancelled' ? next.terminalAt : next.expiredAt;
    const nowMs = this.#clock.now().getTime();
    const results = await this.#database.batch([
      this.#database
        .prepare(
          next.state === 'expired'
            ? insertExpiredTerminalCasSql
            : insertCancelledTerminalCasSql,
        )
        .bind(
          next.sessionId,
          next.ownerId,
          next.channel,
          next.conversationId,
          next.state,
          next.sessionVersion,
          sourceVersion,
          next.requestToken,
          next.normalizedOwnerQuery,
          Date.parse(terminalAt),
          Date.parse(next.retainUntil),
          JSON.stringify(next),
          sessionId,
          scope.ownerId,
          scope.channel,
          scope.conversationId,
          expectedVersion,
          nowMs,
        ),
      this.#database
        .prepare(deleteActiveCasSql)
        .bind(
          sessionId,
          scope.ownerId,
          scope.channel,
          scope.conversationId,
          expectedVersion,
          next.state,
          expectedVersion,
        ),
    ]);
    if (changes(results[1]) === 1) {
      return { kind: 'applied' as const, session: next };
    }
    const current = await this.get(scope, sessionId);
    return {
      kind: 'conflict' as const,
      ...(current ? { current } : {}),
    };
  }

  async consumeResearchPhase(input: {
    readonly scope: CatalogIntakeScope;
    readonly sessionId: string;
    readonly expectedSessionVersion: number;
    readonly phase: 'initial' | 'confirm';
    readonly queryOrUrlsDigest: string;
    readonly requestId: string;
    readonly selectedIdentity?: CatalogIntakeSelectedSubject;
  }) {
    if (
      !/^[0-9a-f]{64}$/u.test(input.queryOrUrlsDigest) ||
      input.requestId.length < 1 ||
      input.requestId.length > 200
    ) {
      return { kind: 'conflict' as const };
    }
    const nowMs = this.#clock.now().getTime();
    const budget = catalogIntakeResearchBudgets[input.phase];
    const phaseState =
      input.phase === 'confirm' ? 'preview_ready' : 'candidates_ready';
    const digestPath = `$.researchPhaseDigests.${input.phase}`;
    let eligibilityDigest = input.queryOrUrlsDigest;
    if (input.selectedIdentity !== undefined) {
      const session = await this.get(input.scope, input.sessionId);
      const selectedIdentityMatches =
        input.phase === 'initial'
          ? session?.state === 'candidates_ready' &&
            session.candidates.some(
              (candidate) =>
                candidate.providerNamespace ===
                  input.selectedIdentity?.providerNamespace &&
                candidate.placeId === input.selectedIdentity.placeId,
            )
          : session?.state === 'preview_ready' &&
            session.preview.candidateIdentity.providerNamespace ===
              input.selectedIdentity.providerNamespace &&
            session.preview.candidateIdentity.placeId ===
              input.selectedIdentity.placeId;
      if (!selectedIdentityMatches) {
        return { kind: 'conflict' as const };
      }
      if (
        !session ||
        (session.state !== 'candidates_ready' &&
          session.state !== 'preview_ready')
      ) {
        return { kind: 'conflict' as const };
      }
      eligibilityDigest = session.researchPhaseDigests[input.phase] ?? '';
    }
    const result = await this.#database
      .prepare(consumeResearchPhaseSql)
      .bind(
        input.sessionId,
        input.phase,
        input.queryOrUrlsDigest,
        input.requestId,
        budget.searchQueries,
        budget.pageRequests,
        budget.maxDurationMs,
        nowMs,
        nowMs + budget.maxDurationMs,
        researchSpendRetentionMs,
        input.sessionId,
        input.scope.ownerId,
        input.scope.channel,
        input.scope.conversationId,
        input.expectedSessionVersion,
        nowMs,
        phaseState,
        digestPath,
        eligibilityDigest,
      )
      .run();
    if (changes(result) === 1) {
      const row = await this.#database
        .prepare(findResearchSpendSql)
        .bind(input.sessionId, input.phase)
        .first<ResearchSpendRow>();
      if (!row) throw new Error('Research allowance write was not visible.');
      const allowance: CatalogIntakeResearchAllowance = {
        sessionId: input.sessionId,
        phase: input.phase,
        queryOrUrlsDigest: input.queryOrUrlsDigest,
        maxCounts: {
          searchQueries: budget.searchQueries,
          pageRequests: budget.pageRequests,
        },
        maxDurationMs: budget.maxDurationMs,
        requestTimeoutMs: 15_000,
        maxRedirects: 3,
        deadline: new Date(row.deadline_ms).toISOString(),
        requestId: input.requestId,
      };
      return { kind: 'consumed' as const, allowance };
    }
    const eligible = await this.#database
      .prepare(findResearchEligibilitySql)
      .bind(
        digestPath,
        input.sessionId,
        input.scope.ownerId,
        input.scope.channel,
        input.scope.conversationId,
      )
      .first<ResearchEligibilityRow>();
    if (
      !eligible ||
      eligible.session_version !== input.expectedSessionVersion
    ) {
      return { kind: 'conflict' as const };
    }
    if (nowMs >= eligible.expires_at_ms) {
      return { kind: 'expired' as const };
    }
    if (eligible.state !== phaseState) return { kind: 'conflict' as const };
    if (eligible.research_digest !== eligibilityDigest) {
      return { kind: 'conflict' as const };
    }
    const spent = await this.#database
      .prepare(findResearchSpendSql)
      .bind(input.sessionId, input.phase)
      .first<ResearchSpendRow>();
    if (spent) return { kind: 'already_spent' as const };
    return { kind: 'conflict' as const };
  }

  async cleanup(now: Date) {
    const nowMs = now.getTime();
    const retainUntilMs = nowMs + retentionMs;
    const results = await this.#database.batch([
      this.#database
        .prepare(expireSessionsSql)
        .bind(
          nowMs,
          retainUntilMs,
          now.toISOString(),
          now.toISOString(),
          new Date(retainUntilMs).toISOString(),
          nowMs,
        ),
      this.#database.prepare(deleteExpiredActiveSql).bind(nowMs),
      this.#database.prepare(deleteTerminalSql).bind(nowMs),
      this.#database.prepare(deleteTokensSql).bind(nowMs),
      this.#database.prepare(deletePublishReceiptsSql).bind(nowMs),
      this.#database.prepare(deleteResearchSpendsSql).bind(nowMs),
    ]);
    return {
      expired: changes(results[1]),
      removed: changes(results[2]),
    };
  }
}

const retentionMs = 180 * 24 * 60 * 60 * 1000;
const researchSpendRetentionMs = 24 * 60 * 60 * 1000;
const scopeWhere = 'owner_id = ? AND channel = ? AND conversation_id = ?';
const findRequestSql =
  'SELECT normalized_owner_query, session_id ' +
  'FROM catalog_intake_request_tokens WHERE ' +
  scopeWhere +
  ' AND request_token = ?';
const insertTokenSql =
  'INSERT INTO catalog_intake_request_tokens ' +
  '(owner_id, channel, conversation_id, request_token, ' +
  'normalized_owner_query, session_id, retain_until_ms) ' +
  'VALUES (?, ?, ?, ?, ?, ?, ?)';
const replaceTerminalSql =
  'INSERT INTO catalog_intake_terminal_refs ' +
  '(session_id, owner_id, channel, conversation_id, state, session_version, ' +
  'source_version, request_token, normalized_owner_query, terminal_at_ms, ' +
  'retain_until_ms, terminal_json) ' +
  "SELECT session_id, owner_id, channel, conversation_id, 'cancelled', " +
  'session_version + 1, session_version, request_token, ' +
  'normalized_owner_query, ?, ?, json_object(' +
  "'sessionId', session_id, 'sessionVersion', session_version + 1, " +
  "'state', 'cancelled', 'ownerId', owner_id, 'channel', channel, " +
  "'conversationId', conversation_id, 'cancelledFromVersion', " +
  "session_version, 'requestToken', request_token, " +
  "'normalizedOwnerQuery', normalized_owner_query, 'terminalAt', ?, " +
  "'retainUntil', ?) FROM catalog_intake_sessions WHERE " +
  scopeWhere;
const deleteActiveScopeSql =
  'DELETE FROM catalog_intake_sessions AS active WHERE ' +
  scopeWhere +
  ' AND EXISTS (SELECT 1 FROM catalog_intake_terminal_refs AS terminal ' +
  'WHERE terminal.session_id = active.session_id ' +
  "AND terminal.state = 'cancelled' " +
  'AND terminal.source_version = active.session_version)';
const findActiveSql =
  'SELECT session_json AS value_json FROM catalog_intake_sessions ' +
  'WHERE session_id = ? AND ' +
  scopeWhere;
const findTerminalSql =
  'SELECT terminal_json AS value_json FROM catalog_intake_terminal_refs ' +
  'WHERE session_id = ? AND ' +
  scopeWhere +
  ' AND retain_until_ms > ?';
const updateActiveSql =
  'UPDATE catalog_intake_sessions SET state = ?, session_version = ?, ' +
  'session_json = ?, last_accepted_activity_at_ms = ?, expires_at_ms = ?, ' +
  'updated_at_ms = ? WHERE session_id = ? AND ' +
  scopeWhere +
  ' AND session_version = ? AND expires_at_ms > ?';
const insertTerminalCasSql =
  'INSERT INTO catalog_intake_terminal_refs ' +
  '(session_id, owner_id, channel, conversation_id, state, session_version, ' +
  'source_version, request_token, normalized_owner_query, terminal_at_ms, ' +
  'retain_until_ms, terminal_json) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? ' +
  'FROM catalog_intake_sessions WHERE session_id = ? AND ' +
  scopeWhere +
  ' AND session_version = ?';
const insertExpiredTerminalCasSql =
  insertTerminalCasSql + ' AND expires_at_ms <= ?';
const insertCancelledTerminalCasSql =
  insertTerminalCasSql + ' AND expires_at_ms > ?';
const deleteActiveCasSql =
  'DELETE FROM catalog_intake_sessions WHERE session_id = ? AND ' +
  scopeWhere +
  ' AND session_version = ? AND EXISTS (' +
  'SELECT 1 FROM catalog_intake_terminal_refs AS terminal ' +
  'WHERE terminal.session_id = catalog_intake_sessions.session_id ' +
  'AND terminal.state = ? AND terminal.source_version = ?)';
const expireSessionsSql =
  'INSERT INTO catalog_intake_terminal_refs ' +
  '(session_id, owner_id, channel, conversation_id, state, session_version, ' +
  'source_version, request_token, normalized_owner_query, terminal_at_ms, ' +
  'retain_until_ms, terminal_json) SELECT session_id, owner_id, channel, ' +
  "conversation_id, 'expired', session_version + 1, session_version, " +
  'request_token, normalized_owner_query, ?, ?, json_object(' +
  "'sessionId', session_id, 'sessionVersion', session_version + 1, " +
  "'state', 'expired', 'ownerId', owner_id, 'channel', channel, " +
  "'conversationId', conversation_id, 'expiredFromVersion', session_version, " +
  "'expiredAt', ?, 'requestToken', request_token, 'normalizedOwnerQuery', " +
  "normalized_owner_query, 'terminalAt', ?, 'retainUntil', ?) " +
  'FROM catalog_intake_sessions WHERE expires_at_ms <= ?';
const deleteExpiredActiveSql =
  'DELETE FROM catalog_intake_sessions AS active WHERE expires_at_ms <= ? ' +
  'AND EXISTS (SELECT 1 FROM catalog_intake_terminal_refs AS terminal ' +
  'WHERE terminal.session_id = active.session_id ' +
  "AND terminal.state = 'expired' " +
  'AND terminal.source_version = active.session_version)';
const deleteTerminalSql =
  'DELETE FROM catalog_intake_terminal_refs WHERE retain_until_ms <= ?';
const deleteTokensSql =
  'DELETE FROM catalog_intake_request_tokens WHERE retain_until_ms <= ?';
const deletePublishReceiptsSql =
  'DELETE FROM catalog_intake_publish_receipts WHERE retain_until_ms <= ?';
const consumeResearchPhaseSql =
  'INSERT OR IGNORE INTO catalog_intake_research_phase_spends ' +
  '(session_id, phase, query_or_urls_digest, request_id, ' +
  'max_search_queries, max_page_requests, max_duration_ms, ' +
  'request_timeout_ms, max_redirects, spent_at_ms, deadline_ms, ' +
  'retain_until_ms) SELECT ?, ?, ?, ?, ?, ?, ?, 15000, 3, ?, ' +
  'MIN(?, expires_at_ms), expires_at_ms + ? FROM catalog_intake_sessions ' +
  'WHERE session_id = ? AND ' +
  scopeWhere +
  ' AND session_version = ? AND expires_at_ms > ? ' +
  'AND state = ? AND json_extract(session_json, ?) = ?';
const findResearchSpendSql =
  'SELECT deadline_ms FROM catalog_intake_research_phase_spends ' +
  'WHERE session_id = ? AND phase = ?';
const findResearchEligibilitySql =
  'SELECT state, session_version, expires_at_ms, ' +
  'json_extract(session_json, ?) AS research_digest ' +
  'FROM catalog_intake_sessions ' +
  'WHERE session_id = ? AND ' +
  scopeWhere;
const deleteResearchSpendsSql =
  'DELETE FROM catalog_intake_research_phase_spends WHERE retain_until_ms <= ?';

function insertSession(
  database: D1Database,
  session: CatalogIntakeCandidatesSession,
): D1PreparedStatement {
  return database
    .prepare(
      'INSERT INTO catalog_intake_sessions ' +
        '(session_id, owner_id, channel, conversation_id, state, ' +
        'session_version, request_token, normalized_owner_query, session_json, ' +
        'last_accepted_activity_at_ms, expires_at_ms, created_at_ms, ' +
        'updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      session.sessionId,
      session.ownerId,
      session.channel,
      session.conversationId,
      session.state,
      session.sessionVersion,
      session.requestToken,
      session.normalizedOwnerQuery,
      JSON.stringify(session),
      Date.parse(session.lastAcceptedActivityAt),
      Date.parse(session.expiresAt),
      Date.parse(session.createdAt),
      Date.parse(session.createdAt),
    );
}

function replayOrConflict(
  session: CatalogIntakeStoredSession,
  normalizedOwnerQuery: string,
) {
  return session.normalizedOwnerQuery === normalizedOwnerQuery
    ? { kind: 'replay' as const, session }
    : { kind: 'conflict' as const };
}

function parseStored(json: string): CatalogIntakeStoredSession {
  const parsed: unknown = JSON.parse(json);
  if (
    isRecord(parsed) &&
    parsed.state === 'preview_ready' &&
    (!isRecord(parsed.preview) ||
      !hasCanonicalCatalogIntakeWarningOrder(parsed.preview.warnings))
  ) {
    throw new Error('Catalog intake session has invalid warning order.');
  }
  return parsed as CatalogIntakeStoredSession;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function changes(result: D1Result<unknown>): number {
  return Number(result.meta?.changes ?? 0);
}
