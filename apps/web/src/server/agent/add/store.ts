// D1 storage for the Add workflow: the conversation's session (one active per conversation,
// terminal receipts kept 180 days) and the one-shot publisher that turns a confirmed preview into
// a saved restaurant. Every write is conditional on the exact session version and preview, so a
// retried or raced confirm commits at most once and replays its receipt.
import type {
  AtlasCatalogIntakePort,
  CatalogIntakeCandidatesSession,
  CatalogIntakeConfirmOutput,
  CatalogIntakePreview,
  CatalogIntakeScope,
  CatalogIntakeStatePort,
  CatalogIntakeStoredSession,
} from './workflow.ts';
import { hasPublishableLocation } from './workflow.ts';
import { digestCanonical } from './validate.ts';
import type { AtlasItem, ReservationSnapshot } from './stored-item.ts';
import { hasCanonicalCatalogIntakeWarningOrder } from '../../../shared/catalog-intake-warnings.ts';
import { compactRestaurantTags } from '../../../shared/restaurant-profile.ts';
import { withRestaurantClassification } from '../../../shared/cuisine.ts';
import { formatOpeningHours } from '../../../shared/hours.ts';

interface JsonRow {
  readonly value_json: string;
}

interface ReceiptRow {
  readonly outcome_json: string;
}

interface RevisionRow {
  readonly revision_number: number;
}

interface SafeNoWriteRow {
  readonly safe_no_write: number;
}

interface PublisherRuntime {
  readonly now: () => Date;
  readonly nextId: () => string;
}

export class D1CatalogIntakeState implements CatalogIntakeStatePort {
  readonly #database: D1Database;
  readonly #clock: { now(): Date };

  constructor(database: D1Database, clock: { now(): Date } = { now: () => new Date() }) {
    this.#database = database;
    this.#clock = clock;
  }

  async create(session: CatalogIntakeCandidatesSession): Promise<void> {
    const createdAtMs = Date.parse(session.createdAt);
    const retainUntilMs = createdAtMs + retentionMs;
    await this.#database.batch([
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
      return { kind: 'conflict' as const, ...(current ? { current } : {}) };
    }
    if (next.state === 'committed') {
      throw new Error('Committed intake sessions are written only by Atlas Catalog publish.');
    }

    const sourceVersion =
      next.state === 'cancelled' ? next.cancelledFromVersion : next.expiredFromVersion;
    const terminalAt = next.state === 'cancelled' ? next.terminalAt : next.expiredAt;
    const nowMs = this.#clock.now().getTime();
    const results = await this.#database.batch([
      this.#database
        .prepare(
          next.state === 'expired' ? insertExpiredTerminalCasSql : insertCancelledTerminalCasSql,
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
    return { kind: 'conflict' as const, ...(current ? { current } : {}) };
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
    return { expired: changes(results[1]), removed: changes(results[2]) };
  }
}

const retentionMs = 180 * 24 * 60 * 60 * 1000;
const scopeWhere = 'owner_id = ? AND channel = ? AND conversation_id = ?';
const replaceTerminalSql = `
  INSERT INTO catalog_intake_terminal_refs (session_id, owner_id, channel, conversation_id,
  state, session_version, source_version, request_token, normalized_owner_query,
  terminal_at_ms, retain_until_ms, terminal_json)
  SELECT session_id, owner_id, channel, conversation_id, 'cancelled', session_version + 1,
  session_version, request_token, normalized_owner_query, ?, ?, json_object('sessionId',
  session_id, 'sessionVersion', session_version + 1, 'state', 'cancelled', 'ownerId', owner_id,
  'channel', channel, 'conversationId', conversation_id, 'cancelledFromVersion',
  session_version, 'requestToken', request_token, 'normalizedOwnerQuery',
  normalized_owner_query, 'terminalAt', ?, 'retainUntil', ?)
  FROM catalog_intake_sessions WHERE ${scopeWhere}`;
const deleteActiveScopeSql = `
  DELETE FROM catalog_intake_sessions AS active WHERE ${scopeWhere} AND EXISTS (SELECT 1
  FROM catalog_intake_terminal_refs AS terminal WHERE terminal.session_id = active.session_id
  AND terminal.state = 'cancelled' AND terminal.source_version = active.session_version)`;
const findActiveSql = `
  SELECT session_json AS value_json FROM catalog_intake_sessions WHERE session_id = ?
  AND ${scopeWhere}`;
const findTerminalSql = `
  SELECT terminal_json AS value_json FROM catalog_intake_terminal_refs WHERE session_id = ?
  AND ${scopeWhere} AND retain_until_ms > ?`;
const updateActiveSql = `
  UPDATE catalog_intake_sessions SET state = ?, session_version = ?, session_json = ?,
  last_accepted_activity_at_ms = ?, expires_at_ms = ?, updated_at_ms = ?
  WHERE session_id = ? AND ${scopeWhere} AND session_version = ? AND expires_at_ms > ?`;
const insertTerminalCasSql = `
  INSERT INTO catalog_intake_terminal_refs (session_id, owner_id, channel, conversation_id,
  state, session_version, source_version, request_token, normalized_owner_query,
  terminal_at_ms, retain_until_ms, terminal_json)
  SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM catalog_intake_sessions WHERE session_id = ?
  AND ${scopeWhere} AND session_version = ?`;
const insertExpiredTerminalCasSql = `${insertTerminalCasSql} AND expires_at_ms <= ?`;
const insertCancelledTerminalCasSql = `${insertTerminalCasSql} AND expires_at_ms > ?`;
const deleteActiveCasSql = `
  DELETE FROM catalog_intake_sessions WHERE session_id = ? AND ${scopeWhere}
  AND session_version = ? AND EXISTS (SELECT 1 FROM catalog_intake_terminal_refs AS terminal
  WHERE terminal.session_id = catalog_intake_sessions.session_id AND terminal.state = ?
  AND terminal.source_version = ?)`;
const expireSessionsSql = `
  INSERT INTO catalog_intake_terminal_refs (session_id, owner_id, channel, conversation_id,
  state, session_version, source_version, request_token, normalized_owner_query,
  terminal_at_ms, retain_until_ms, terminal_json)
  SELECT session_id, owner_id, channel, conversation_id, 'expired', session_version + 1,
  session_version, request_token, normalized_owner_query, ?, ?, json_object('sessionId',
  session_id, 'sessionVersion', session_version + 1, 'state', 'expired', 'ownerId', owner_id,
  'channel', channel, 'conversationId', conversation_id, 'expiredFromVersion', session_version,
  'expiredAt', ?, 'requestToken', request_token, 'normalizedOwnerQuery',
  normalized_owner_query, 'terminalAt', ?, 'retainUntil', ?)
  FROM catalog_intake_sessions WHERE expires_at_ms <= ?`;
const deleteExpiredActiveSql = `
  DELETE FROM catalog_intake_sessions AS active WHERE expires_at_ms <= ? AND EXISTS (SELECT 1
  FROM catalog_intake_terminal_refs AS terminal WHERE terminal.session_id = active.session_id
  AND terminal.state = 'expired' AND terminal.source_version = active.session_version)`;
const deleteTerminalSql = 'DELETE FROM catalog_intake_terminal_refs WHERE retain_until_ms <= ?';
const deleteTokensSql = 'DELETE FROM catalog_intake_request_tokens WHERE retain_until_ms <= ?';
const deletePublishReceiptsSql =
  'DELETE FROM catalog_intake_publish_receipts WHERE retain_until_ms <= ?';
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

function parseStored(json: string): CatalogIntakeStoredSession {
  const parsed: unknown = JSON.parse(json);
  if (
    isRecord(parsed) &&
    parsed.state === 'preview_ready' &&
    (!isRecord(parsed.preview) || !hasCanonicalCatalogIntakeWarningOrder(parsed.preview.warnings))
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

export class D1AtlasCatalogIntakePublisher implements AtlasCatalogIntakePort {
  readonly #database: D1Database;
  readonly #runtime: PublisherRuntime;

  constructor(database: D1Database, runtime: PublisherRuntime) {
    this.#database = database;
    this.#runtime = runtime;
  }

  async publish(
    preview: CatalogIntakePreview,
    mutationKey: string,
    expectedSessionVersion: number,
    catalogRevision: string,
  ): Promise<CatalogIntakeConfirmOutput> {
    if (
      !/^[a-f0-9]{64}$/u.test(mutationKey) ||
      !Number.isInteger(expectedSessionVersion) ||
      expectedSessionVersion < 1 ||
      preview.catalogRevision !== catalogRevision
    ) {
      return { status: 'failed_no_write', reason: 'validation' };
    }
    const { evidenceDigest: _claimedDigest, ...previewWithoutDigest } = preview;
    if (
      !hasPublishableLocation(preview) ||
      (await digestCanonical(previewWithoutDigest)) !== preview.evidenceDigest
    ) {
      return { status: 'failed_no_write', reason: 'validation' };
    }

    const replay = await this.#receipt(mutationKey);
    if (replay) return replayOutcome(replay);
    const currentRevision = await this.#revision();
    if (currentRevision !== catalogRevision) {
      return this.#refreshRevisionConflict(
        preview,
        mutationKey,
        expectedSessionVersion,
        currentRevision,
      );
    }

    const now = this.#runtime.now();
    const itemId = this.#runtime.nextId();
    // An earlier incomplete Add (a stored review candidate) is promoted under its identity and
    // creation audit; a public item is never overwritten. Every write below re-checks the preview
    // and the catalog revision atomically.
    const promotion = await this.#database
      .prepare(findPromotableIdentitySql)
      .bind(preview.candidateIdentity.providerNamespace, preview.candidateIdentity.placeId)
      .first<{ item_id: string }>();
    const promotionId = promotion?.item_id ?? null;
    const item = toAtlasItem(preview, promotionId ?? itemId, now);
    const retainUntilMs = now.getTime() + 180 * 24 * 60 * 60 * 1000;

    try {
      const results = await this.#database.batch([
        this.#database
          .prepare(insertIdentitySql)
          .bind(
            preview.candidateIdentity.providerNamespace,
            preview.candidateIdentity.placeId,
            itemId,
            mutationKey,
            now.getTime(),
            ...activeCondition(
              preview,
              mutationKey,
              expectedSessionVersion,
              catalogRevision,
              now.getTime(),
            ),
          ),
        this.#database
          .prepare(insertClaimSql)
          .bind(
            mutationKey,
            itemId,
            ...activeCondition(
              preview,
              mutationKey,
              expectedSessionVersion,
              catalogRevision,
              now.getTime(),
            ),
          ),
        this.#database
          .prepare(insertItemSql)
          .bind(
            promotionId ?? itemId,
            JSON.stringify(item),
            now.toISOString(),
            now.toISOString(),
            mutationKey,
            itemId,
            preview.candidateIdentity.providerNamespace,
            preview.candidateIdentity.placeId,
            mutationKey,
            promotionId,
            ...activeCondition(
              preview,
              mutationKey,
              expectedSessionVersion,
              catalogRevision,
              now.getTime(),
            ),
          ),
        this.#database
          .prepare(insertReceiptSql)
          .bind(
            mutationKey,
            preview.sessionId,
            preview.previewVersion,
            preview.evidenceDigest,
            expectedSessionVersion,
            catalogRevision,
            itemId,
            mutationKey,
            promotionId,
            'committed_verified',
            mutationKey,
            now.getTime(),
            retainUntilMs,
            mutationKey,
            itemId,
            preview.candidateIdentity.providerNamespace,
            preview.candidateIdentity.placeId,
            ...activeCondition(
              preview,
              mutationKey,
              expectedSessionVersion,
              catalogRevision,
              now.getTime(),
            ),
          ),
        this.#database
          .prepare(insertGoogleReferenceSql)
          .bind(
            promotionId ?? itemId,
            now.toISOString(),
            now.toISOString(),
            preview.sessionId,
            mutationKey,
            preview.candidateIdentity.placeId,
          ),
        this.#database
          .prepare(insertCommittedTerminalSql)
          .bind(
            now.getTime(),
            retainUntilMs,
            now.getTime(),
            retainUntilMs,
            mutationKey,
            itemId,
            preview.sessionId,
          ),
        this.#database
          .prepare(deleteCommittedActiveSql)
          .bind(preview.sessionId, mutationKey, itemId),
        this.#database.prepare(incrementRevisionSql).bind(mutationKey, itemId),
        this.#database.prepare(deleteClaimSql).bind(mutationKey, itemId),
        this.#database.prepare(deletePromotedCandidateSql).bind(promotionId, mutationKey, itemId),
      ]);
      const receipt = await this.#receipt(mutationKey);
      if (receipt) {
        return changes(results[3]) === 1
          ? parseOutcome(receipt.outcome_json)
          : replayOutcome(receipt);
      }
    } catch {
      try {
        const committed = await this.#receipt(mutationKey);
        if (committed) return replayOutcome(committed);
        if (
          await this.#confirmedNoWrite(
            preview,
            mutationKey,
            expectedSessionVersion,
            catalogRevision,
            now.getTime(),
          )
        ) {
          return { status: 'failed_no_write', reason: 'transaction' };
        }
      } catch {
        // A failed recovery read leaves the commit outcome ambiguous.
      }
      return { status: 'conflict', newPreview: preview };
    }

    const receipt = await this.#receipt(mutationKey);
    if (receipt) return parseOutcome(receipt.outcome_json);
    const racedRevision = await this.#revision();
    if (racedRevision !== catalogRevision) {
      return this.#refreshRevisionConflict(
        preview,
        mutationKey,
        expectedSessionVersion,
        racedRevision,
      );
    }
    return { status: 'conflict', newPreview: preview };
  }

  async #receipt(mutationKey: string): Promise<ReceiptRow | undefined> {
    return (
      (await this.#database
        .prepare(findReceiptSql)
        .bind(mutationKey, this.#runtime.now().getTime())
        .first<ReceiptRow>()) ?? undefined
    );
  }

  async #revision(): Promise<string> {
    const row = await this.#database.prepare(findRevisionSql).first<RevisionRow>();
    return row ? 'catalog-r' + row.revision_number : 'catalog-missing';
  }

  async #confirmedNoWrite(
    preview: CatalogIntakePreview,
    mutationKey: string,
    expectedSessionVersion: number,
    catalogRevision: string,
    nowMs: number,
  ): Promise<boolean> {
    const row = await this.#database
      .prepare(confirmNoWriteSql)
      .bind(
        ...activeCondition(preview, mutationKey, expectedSessionVersion, catalogRevision, nowMs),
        preview.candidateIdentity.providerNamespace,
        preview.candidateIdentity.placeId,
        mutationKey,
        mutationKey,
      )
      .first<SafeNoWriteRow>();
    return row?.safe_no_write === 1;
  }

  async #refreshRevisionConflict(
    preview: CatalogIntakePreview,
    mutationKey: string,
    expectedSessionVersion: number,
    catalogRevision: string,
  ): Promise<CatalogIntakeConfirmOutput> {
    const now = this.#runtime.now();
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000).toISOString();
    const { evidenceDigest: _priorDigest, ...priorWithoutDigest } = preview;
    const withoutDigest = {
      ...priorWithoutDigest,
      previewVersion: preview.previewVersion + 1,
      catalogRevision,
      expiresAt,
    };
    const newPreview: CatalogIntakePreview = {
      ...withoutDigest,
      evidenceDigest: await digestCanonical(withoutDigest),
    };
    const result = await this.#database
      .prepare(refreshRevisionConflictSql)
      .bind(
        expectedSessionVersion + 1,
        expectedSessionVersion + 1,
        JSON.stringify(newPreview),
        catalogRevision,
        now.toISOString(),
        expiresAt,
        newPreview.previewVersion,
        now.getTime(),
        Date.parse(expiresAt),
        now.getTime(),
        preview.sessionId,
        expectedSessionVersion,
        preview.evidenceDigest,
        JSON.stringify(preview),
        mutationKey,
        now.getTime(),
        catalogRevision,
      )
      .run();
    return changes(result) === 1
      ? { status: 'conflict', newPreview }
      : { status: 'conflict', newPreview: preview };
  }
}

const activeWhere = `
  s.session_id = ? AND s.state = 'preview_ready' AND s.session_version = ?
  AND json_extract(s.session_json, '$.preview.previewVersion') = ?
  AND json_extract(s.session_json, '$.preview.evidenceDigest') = ?
  AND json_extract(s.session_json, '$.preview.candidateIdentity.providerNamespace') = ?
  AND json_extract(s.session_json, '$.preview.candidateIdentity.placeId') = ?
  AND json_extract(s.session_json, '$.confirmMutationKey') = ?
  AND ('catalog-r' || r.revision_number) = ?
  AND json_extract(s.session_json, '$.preview') = json(?) AND s.expires_at_ms > ?`;

const insertIdentitySql = `
  INSERT OR IGNORE INTO atlas_place_identities (provider_namespace, place_id, item_id,
  created_by_mutation_key, created_at_ms)
  SELECT ?, ?, ?, ?, ? FROM catalog_intake_sessions s
  JOIN atlas_catalog_revision r ON r.singleton = 1 WHERE ${activeWhere}`;

const insertClaimSql = `
  INSERT OR IGNORE INTO catalog_intake_publish_claims (mutation_key, claim_attempt_id)
  SELECT ?, ? FROM catalog_intake_sessions s JOIN atlas_catalog_revision r ON r.singleton = 1
  WHERE ${activeWhere}`;

const findPromotableIdentitySql = `
  SELECT i.item_id FROM atlas_place_identities i
  JOIN atlas_review_candidates candidate ON candidate.id = i.item_id
  WHERE i.provider_namespace = ? AND i.place_id = ? AND NOT EXISTS (SELECT 1
  FROM atlas_items item WHERE item.id = i.item_id)`;

const deletePromotedCandidateSql = `
  DELETE FROM atlas_review_candidates WHERE id = ? AND EXISTS (SELECT 1
  FROM catalog_intake_publish_receipts receipt
  JOIN atlas_items item ON item.id = receipt.item_id WHERE receipt.mutation_key = ?
  AND receipt.claim_attempt_id = ? AND receipt.item_id = atlas_review_candidates.id
  AND json_extract(receipt.outcome_json, '$.status') = 'committed_verified')`;

const insertItemSql = `
  INSERT INTO atlas_items (id, payload_json, verification_status, created_at, updated_at)
  SELECT ?, ?, 'verified', ?, ? FROM atlas_place_identities i
  JOIN catalog_intake_sessions s ON 1 = 1 JOIN atlas_catalog_revision r ON r.singleton = 1
  JOIN catalog_intake_publish_claims claim ON claim.mutation_key = ?
  AND claim.claim_attempt_id = ? WHERE i.provider_namespace = ? AND i.place_id = ?
  AND (i.created_by_mutation_key = ? OR i.item_id = ?) AND ${activeWhere}`;

const insertReceiptSql = `
  INSERT OR IGNORE INTO catalog_intake_publish_receipts (mutation_key, session_id,
  preview_version, preview_digest, source_session_version, catalog_revision, claim_attempt_id,
  item_id, outcome_json, committed_at_ms, retain_until_ms)
  SELECT ?, ?, ?, ?, ?, ?, ?, i.item_id, json_object('status', CASE
  WHEN i.created_by_mutation_key = ? OR i.item_id = ? THEN ?
  ELSE 'reused_existing' END, 'itemId', i.item_id, 'receiptRef', ?, 'replayed', json('false')),
  ?, ?
  FROM atlas_place_identities i JOIN catalog_intake_sessions s ON 1 = 1
  JOIN atlas_catalog_revision r ON r.singleton = 1
  JOIN catalog_intake_publish_claims claim ON claim.mutation_key = ?
  AND claim.claim_attempt_id = ? WHERE i.provider_namespace = ? AND i.place_id = ?
  AND (EXISTS (SELECT 1 FROM atlas_items item WHERE item.id = i.item_id) OR EXISTS (SELECT 1
  FROM atlas_review_candidates candidate WHERE candidate.id = i.item_id)) AND ${activeWhere}`;

const insertCommittedTerminalSql = `
  INSERT INTO catalog_intake_terminal_refs (session_id, owner_id, channel, conversation_id,
  state, session_version, source_version, request_token, normalized_owner_query,
  terminal_at_ms, retain_until_ms, terminal_json)
  SELECT s.session_id, s.owner_id, s.channel, s.conversation_id, 'committed',
  s.session_version + 1, s.session_version, s.request_token, s.normalized_owner_query, ?, ?,
  json_object('sessionId', s.session_id, 'sessionVersion', s.session_version + 1, 'state',
  'committed', 'ownerId', s.owner_id, 'channel', s.channel, 'conversationId',
  s.conversation_id, 'committedFromVersion', s.session_version, 'requestToken',
  s.request_token, 'normalizedOwnerQuery', s.normalized_owner_query, 'terminalAt',
  strftime('%Y-%m-%dT%H:%M:%fZ', ? / 1000, 'unixepoch'), 'retainUntil',
  strftime('%Y-%m-%dT%H:%M:%fZ', ? / 1000, 'unixepoch'), 'mutationKey', receipt.mutation_key,
  'previewVersion', receipt.preview_version, 'evidenceDigest', receipt.preview_digest,
  'outcome', json(receipt.outcome_json))
  FROM catalog_intake_sessions s
  JOIN catalog_intake_publish_receipts receipt ON receipt.mutation_key = ?
  AND receipt.claim_attempt_id = ? WHERE s.session_id = ?`;

const deleteCommittedActiveSql = `
  DELETE FROM catalog_intake_sessions WHERE session_id = ? AND EXISTS (SELECT 1
  FROM catalog_intake_terminal_refs terminal
  JOIN catalog_intake_publish_receipts receipt ON receipt.session_id = terminal.session_id
  WHERE terminal.session_id = catalog_intake_sessions.session_id
  AND terminal.state = 'committed' AND receipt.mutation_key = ?
  AND receipt.claim_attempt_id = ?)`;

const incrementRevisionSql = `
  UPDATE atlas_catalog_revision SET revision_number = revision_number + 1 WHERE singleton = 1
  AND EXISTS (SELECT 1 FROM catalog_intake_publish_receipts receipt
  WHERE receipt.mutation_key = ?
  AND json_extract(receipt.outcome_json, '$.status') <> 'reused_existing'
  AND receipt.claim_attempt_id = ?)`;

const deleteClaimSql = `
  DELETE FROM catalog_intake_publish_claims WHERE mutation_key = ? AND claim_attempt_id = ?`;

const findReceiptSql = `
  SELECT outcome_json FROM catalog_intake_publish_receipts WHERE mutation_key = ?
  AND retain_until_ms > ?`;
const findRevisionSql = 'SELECT revision_number FROM atlas_catalog_revision WHERE singleton = 1';
const confirmNoWriteSql = `
  SELECT 1 AS safe_no_write FROM catalog_intake_sessions s
  JOIN atlas_catalog_revision r ON r.singleton = 1 WHERE ${activeWhere} AND NOT EXISTS (SELECT 1
  FROM atlas_place_identities i WHERE i.provider_namespace = ? AND i.place_id = ?)
  AND NOT EXISTS (SELECT 1 FROM catalog_intake_publish_receipts receipt
  WHERE receipt.mutation_key = ?) AND NOT EXISTS (SELECT 1
  FROM catalog_intake_publish_claims claim WHERE claim.mutation_key = ?)`;
const refreshRevisionConflictSql = `
  UPDATE catalog_intake_sessions SET session_version = ?,
  session_json = json_remove(json_set(session_json, '$.sessionVersion', ?, '$.preview',
  json(?), '$.catalogRevision', ?, '$.lastAcceptedActivityAt', ?, '$.expiresAt', ?,
  '$.confirmResearchedVersion', ?), '$.confirmMutationKey',
  CASE
  WHEN json_type(session_json,
  '$.confirmResearchedVersion') IS NULL THEN '$.confirmResearchedVersion'
  ELSE '$.__none' END), last_accepted_activity_at_ms = ?, expires_at_ms = ?, updated_at_ms = ?
  WHERE session_id = ? AND state = 'preview_ready' AND session_version = ?
  AND json_extract(session_json, '$.preview.evidenceDigest') = ?
  AND json_extract(session_json, '$.preview') = json(?)
  AND json_extract(session_json, '$.confirmMutationKey') = ? AND expires_at_ms > ?
  AND EXISTS (SELECT 1 FROM atlas_catalog_revision r WHERE r.singleton = 1
  AND ('catalog-r' || r.revision_number) = ?)`;

function activeCondition(
  preview: CatalogIntakePreview,
  mutationKey: string,
  expectedSessionVersion: number,
  catalogRevision: string,
  nowMs: number,
) {
  return [
    preview.sessionId,
    expectedSessionVersion,
    preview.previewVersion,
    preview.evidenceDigest,
    preview.candidateIdentity.providerNamespace,
    preview.candidateIdentity.placeId,
    mutationKey,
    catalogRevision,
    JSON.stringify(preview),
    nowMs,
  ] as const;
}

function toAtlasItem(preview: CatalogIntakePreview, itemId: string, now: Date): AtlasItem {
  const location =
    preview.locationEvidence.status === 'known' ? preview.locationEvidence : undefined;
  const title = preview.ownerFields.title ?? preview.titleProposal?.value;
  const address = preview.ownerFields.address ?? preview.addressProposal?.value;
  if (!location || !title || !address) {
    throw new Error('Verified publication requires complete durable evidence.');
  }
  const suppliedOpeningHours = preview.ownerFields.openingHours
    ? { ...preview.ownerFields.openingHours, observedAt: now.toISOString() }
    : preview.profile?.openingHours;
  const openingHours = suppliedOpeningHours
    ? {
        ...suppliedOpeningHours,
        value: formatOpeningHours(suppliedOpeningHours.value),
      }
    : undefined;
  const regularClosingDays = preview.ownerFields.regularClosingDays
    ? {
        ...preview.ownerFields.regularClosingDays,
        observedAt: now.toISOString(),
      }
    : preview.profile?.regularClosingDays;
  return withRestaurantClassification({
    id: itemId,
    kind: 'food',
    title,
    area: preview.ownerFields.area ?? preview.profile?.area?.value ?? '',
    address,
    description: preview.ownerFields.summary ?? preview.profile?.summary?.value ?? '',
    ...(openingHours ? { openingHours } : {}),
    ...(regularClosingDays ? { regularClosingDays } : {}),
    ...(preview.profile?.closingNotes ? { closingNotes: preview.profile.closingNotes } : {}),
    scheduleCheck: {
      openingHours: openingHours ? 'known' : 'unavailable',
      regularClosingDays: regularClosingDays ? 'known' : 'unavailable',
      checkedAt: now.toISOString(),
    },
    ...(preview.profile?.officialWebsite
      ? { officialUrl: preview.profile.officialWebsite.value }
      : {}),
    ...(preview.profile?.googleRating
      ? {
          googleRating: {
            ...preview.profile.googleRating.value,
            url: preview.profile.googleRating.sourceUrl,
            checkedAt: preview.profile.googleRating.observedAt,
          },
        }
      : {}),
    latitude: location.latitude,
    longitude: location.longitude,
    verificationStatus: 'verified',
    verifiedAt: now.toISOString(),
    reservation: reservationSnapshot(preview),
    personalState: 'saved',
    tags: compactRestaurantTags(
      preview.ownerFields.categories ?? preview.profile?.categories?.value ?? [],
      preview.ownerFields.signatureDishes ?? preview.profile?.signatureDishes?.value ?? [],
      preview.ownerFields.area ?? preview.profile?.area?.value,
    ),
    sources: [
      ...(preview.profile?.officialWebsite
        ? [
            {
              role: 'official' as const,
              label: 'Official website',
              url: preview.profile.officialWebsite.value,
            },
          ]
        : []),
      ...(preview.profile?.bookingLink
        ? [
            {
              role: 'reservation' as const,
              label: 'Booking',
              url: preview.profile.bookingLink.value,
            },
          ]
        : []),
    ],
    intakeEvidence: intakeEvidence(preview),
    updatedAt: now.toISOString(),
  });
}

function intakeEvidence(preview: CatalogIntakePreview) {
  return {
    ...(preview.profile
      ? {
          profile: {
            ...preview.profile,
            ...(preview.profile.openingHours
              ? {
                  openingHours: {
                    ...preview.profile.openingHours,
                    value: formatOpeningHours(preview.profile.openingHours.value),
                  },
                }
              : {}),
          },
        }
      : {}),
    candidateIdentity: preview.candidateIdentity,
    ownerFields: {
      ...preview.ownerFields,
      ...(preview.ownerFields.openingHours
        ? {
            openingHours: {
              ...preview.ownerFields.openingHours,
              value: formatOpeningHours(preview.ownerFields.openingHours.value),
            },
          }
        : {}),
    },
    ...(preview.titleProposal ? { titleProposal: preview.titleProposal } : {}),
    ...(preview.addressProposal ? { addressProposal: preview.addressProposal } : {}),
    locationEvidence: preview.locationEvidence,
    tabelog: preview.tabelog,
    reservation: preview.reservation,
    unknownFields: preview.unknownFields,
    warnings: preview.warnings,
  };
}

function reservationSnapshot(preview: CatalogIntakePreview): ReservationSnapshot {
  const bookingUrl = preview.profile?.bookingLink?.value;
  if (preview.reservation.status === 'unknown') {
    return {
      mode: 'unknown',
      label: 'Reservation status is unknown.',
      ...(bookingUrl ? { url: bookingUrl } : {}),
    };
  }
  return {
    mode:
      preview.reservation.mode === 'reservation_required'
        ? 'advance'
        : preview.reservation.mode === 'not_reservable'
          ? 'unavailable'
          : 'unknown',
    label: preview.reservation.label,
    ...(preview.reservation.channel ? { channel: preview.reservation.channel } : {}),
    // Keep the researched reservation policy in intakeEvidence, while the
    // public reservation snapshot points at the verified booking destination.
    url: bookingUrl ?? preview.reservation.url,
    ...(preview.reservation.advanceDays === undefined
      ? {}
      : { advanceDays: preview.reservation.advanceDays }),
    ...(preview.reservation.bookingWindowLabel
      ? { bookingWindowLabel: preview.reservation.bookingWindowLabel }
      : {}),
    ...(preview.reservation.releaseNote ? { releaseNote: preview.reservation.releaseNote } : {}),
  };
}

function replayOutcome(receipt: ReceiptRow): CatalogIntakeConfirmOutput {
  const outcome = parseOutcome(receipt.outcome_json);
  return 'replayed' in outcome ? { ...outcome, replayed: true } : outcome;
}

function parseOutcome(json: string): CatalogIntakeConfirmOutput {
  return JSON.parse(json) as CatalogIntakeConfirmOutput;
}

// The same transaction publishes the preview's rating and place. A failed or
// cancelled Add cannot leave a saved reference; duplicate replay cannot replace it.
const insertGoogleReferenceSql = `INSERT INTO atlas_google_rating_references (item_id, reference_json, updated_at)
  SELECT r.item_id, json_set(s.google_rating_reference_json, '$.itemId', ?, '$.capturedAt', ?), ?
  FROM catalog_intake_sessions AS s JOIN catalog_intake_publish_receipts AS r
    ON r.session_id = s.session_id
  WHERE s.session_id = ? AND r.mutation_key = ?
    AND json_extract(r.outcome_json, '$.status') = 'committed_verified'
    AND json_extract(s.google_rating_reference_json, '$.placeId') = ?
    AND EXISTS (SELECT 1 FROM atlas_items WHERE id = r.item_id AND verification_status = 'verified')
  ON CONFLICT(item_id) DO NOTHING`;
