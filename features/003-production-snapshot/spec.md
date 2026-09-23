# 规格 — 003 生产快照与 T-14 解锁

- 用户确认：2026-09-12

## Problem Statement

用户已经批准清除前端测试状态后切换 Agent-ready core，但不接受没有完整证据和恢复路径的生产 migration。当前生产 Site 没有导出完整 D1 schema/data snapshot 或独立 R2 object manifest 的应用能力；若直接发布已保存的 version 16，其中未执行的 reset migration 会在快照能力可用前先运行。

系统必须先发布一个不执行 reset 的 owner-only 维护能力，在系统级写入冻结下取得并验证 before evidence，并实际证明可把完整 D1 恢复到 before 状态，才允许进入 T-14。任何失败都必须保持旧生产状态；私人数据不得进入 Git、日志或模型输出。

## Solution

把原 `0003_reset_test_place_assessments.sql` 的 SQL 字节与 checksum 原样保存为 pending artifact；新的 active 0003 只建立 maintenance control 与 write-lease 结构。snapshot-only 发布只能包含已经执行的 migration 和新的 maintenance 0003，不能包含 reset。完整 before evidence 与恢复演练通过后，pending reset 才以 active 0004 进入 migration stream；CI 必须证明 0004 与原 pending SQL 逐字节一致。

所有写入口统一通过持久化 maintenance fence。开始 capture 时先原子冻结新写入，再等待已登记的在途 lease 清零；capture 全程绑定同一 maintenance ID，并验证写入 revision、lease 数和 fence 状态没有变化。由本地 CLI 分页获取全部非平台内部 D1 schema/data 以及独立 R2 inventory，生成确定性证据并只写入 owner-only 本地文件。

恢复能力是临时、默认关闭且不被 Agent 发现的 owner-only 基础设施接口。它只能按构建内固定的预期 schema 和已验证 evidence 恢复全部已捕获 D1 schema/data，不接受 evidence 中的 SQL 或任意 SQL；恢复完成后逐对象、逐表复验 before digest。R2 在本 migration 中只做清单验证，不发生对象写入。

## User Stories

1. As the owner, I want a complete pre-migration evidence bundle, so that I can prove what existed before the reset.
2. As the owner, I want snapshot capability deployed before reset, so that obtaining a backup cannot itself clear production state.
3. As the owner, I want every allowed D1 schema object and every row represented, so that silent omissions fail closed.
4. As the owner, I want R2 listed independently from D1 media metadata, so that orphan objects are not silently omitted.
5. As the owner, I want a system-level mutation fence, so that evidence cannot combine states that never existed together.
6. As the owner, I want private evidence stored only in a permission-restricted local file, so that ratings, notes, object keys and sources never enter Git, logs or model output.
7. As the owner, I want deterministic digests and server-derived build identity, so that files from another capture or deployment cannot be substituted accidentally.
8. As the owner, I want a rehearsed full-D1 recovery path, so that an unexpected schema or non-whitelist data change can be rolled back.
9. As the owner, I want confirmations to be short-lived, single-use and operation-bound, so that maintenance authority cannot be replayed.
10. As the owner, I want maintenance endpoints absent from Agent, WebMCP and normal UI capabilities, so that models and product channels cannot invoke them.
11. As the maintainer, I want any auth, pagination, bound, consistency or verification failure to block reset and keep writes frozen.

## Acceptance Criteria

### AC-1 Migration ordering and artifact identity

- Version 16 is permanently retired as a deployment candidate.
- The original reset file is moved to a non-runnable pending location without changing one byte; its reviewed SHA-256 is recorded in CI.
- New active 0003 creates only maintenance control/write-lease structures and contains no PlaceAssessment reset.
- Snapshot-only packaging fails unless it contains the expected applied migrations plus maintenance 0003 and excludes reset SQL.
- Reset-stage packaging fails unless active 0004 is byte-for-byte equal to the reviewed pending reset and no second migration changes the four-field reset semantics.
- Moving an undeployed migration is an explicit one-time exception; deployed migrations remain immutable.

### AC-2 System-level mutation fence

- Every state-changing Web, WebMCP, media and future Agent operation acquires a persisted write lease through one Application-layer mutation wrapper; direct adapter writes fail architecture tests.
- Freeze atomically changes maintenance mode before any new lease can be granted. New mutations return a typed maintenance result and make no D1/R2 change.
- Existing leases have owner, operation ID, start time and bounded expiry. Capture begins only after all live leases are completed or explicitly resolved; expiry alone cannot silently declare an unknown write successful.
- Each committed mutation increments one persistent write revision. Capture records revision before and after D1/R2 enumeration and succeeds only when maintenance ID is unchanged, fence remains frozen, no leases exist and revisions are equal.
- R2 mutations validate the same fence before upload, after upload and before D1 commit; a fence transition requires cleanup or a visible unresolved lease and makes capture fail.

### AC-3 Complete, bounded evidence protocol v1

- Capture includes every `table`, `index`, `trigger` and `view` except names in a checked-in, versioned, closed platform-internal exclusion list. A new unknown internal-looking object fails closed.
- Migration metadata and all product/maintenance tables are included unless explicitly named in that closed exclusion list.
- Every table includes ordered column metadata and every row in a deterministic order. Tables without a stable key use a documented canonical row ordering; duplicate canonical rows retain multiplicity.
- R2 inventory is obtained from the bucket adapter itself across all pages, not inferred from `visit_media`; every entry includes key, bytes, ETag and provider timestamp when available. 同一冻结窗口内必须从第一页开始完成两轮独立枚举，排序后的逐项内容、页终止证据、总数与整体 digest 全部一致；任一差异都表示可能存在带外写入并使 capture 失败。
- Protocol v1 limits are: at most 10,000 total D1 rows, 10,000 R2 objects, 1 MiB canonical bytes per D1 row and 64 MiB total uncompressed evidence. D1 pages contain at most 250 rows and R2 pages at most 1,000 objects. Limits and observed counts are written into the envelope.
- Missing cursors, repeated cursors, provider truncation、两轮 R2 inventory 不一致、bound overflow、schema/revision change or a nonterminal page without a next cursor fails capture; partial evidence can never carry `complete: true`.
- Envelope includes protocol version, maintenance/capture IDs, before/after phase, UTC interval, server-derived source revision and deployment identity, object/table/page counts, bounds, per-section digests and overall SHA-256 integrity digest.

### AC-4 Owner-only maintenance protocol

- Identity is accepted only from the hosting platform's trusted authentication context; user-supplied identity headers, query parameters and cookies outside that context are ignored.
- If the deployed runtime cannot expose a verifiable trusted owner identity, production use is blocked rather than replaced with a shared secret in browser code.
- State-changing maintenance routes accept POST only, send `Cache-Control: no-store`, enforce exact trusted Origin/CSRF checks and require maintenance mode plus the expected maintenance ID.
- Confirmation state is persisted across runtime instances. It is bound to owner identity, maintenance ID, evidence digest and exact action; it expires after 5 minutes and is atomically consumed once.
- 唯一允许承载私密 evidence 的 response 是通过上述 owner、maintenance ID、Origin/CSRF 与 no-store 门禁的专用 snapshot page payload；它使用固定私有 content type、禁止中间缓存与响应体日志，并只允许 CLI 直接写入受限本地文件。
- 除专用 snapshot page payload 外，所有控制响应、错误与结构化日志只允许包含 IDs、counts、timing、digest 与 typed status；不得包含 D1 values、notes、ratings、R2 keys、credentials 或 confirmation values。

### AC-5 Local evidence handling

- CLI accepts only the configured owner-private production Site and literal output paths outside the repository.
- Output must not exist. It is written with owner-only permissions through atomic rename; symlinks and hard-link aliases are rejected.
- CLI prints only capture ID, counts, integrity digest and result status. Evidence rows and object keys are never printed or passed through a model-visible tool output.
- Offline verification recomputes canonical digests, validates all pages/counts/bounds, checks `complete`, and compares server-derived revision/deployment identity with the approved CI artifact.
- Evidence stays outside Git and is retained until T-14 completes plus the agreed backup-retention period.

### AC-6 Full D1 restore without arbitrary SQL

- Restore accepts only a protocol-v1 before envelope that passes AC-5 and matches the current maintenance ID, source scope and approved pre-reset schema version.
- The service uses compiled-in, reviewed schema definitions and explicit per-table restore adapters; it never executes schema SQL supplied by evidence or accepts free-form table/column names.
- Restore covers every captured non-excluded schema object and all rows, including migration and maintenance metadata. Missing/extra objects, unsupported schema versions or unexpected tables fail before mutation.
- Restore runs only while the fence is frozen and uses a persisted restore operation ID with resumable, idempotent phases. Writes stay closed until every object/table/count/digest equals before evidence.
- A single-use 5-minute confirmation is required for both starting restore and finalizing it. Reuse, expiry, altered evidence or wrong deployment/maintenance identity fails closed.
- A fault-injection rehearsal must alter at least one non-PlaceAssessment row and one schema object after a disposable fixture snapshot, then restore and reproduce the complete before D1 digest.
- R2 objects are not written or deleted by reset/restore; before/after R2 manifest equality remains a release gate. Any mismatch requires a separate reviewed R2 recovery plan and blocks reopening writes.

### AC-7 Real-environment acceptance

- Before production, an isolated preview deployment uses real hosting authentication plus disposable D1/R2 bindings with multi-page fixtures.
- Acceptance verifies owner/non-owner access, forged identity headers, cross-origin POST, single-use confirmation across instances, D1/R2 pagination termination, log redaction, write-fence concurrency and full restore fault injection.
- Deployment inspection proves the snapshot-only publish applied no reset migration and reports its actual server build/deployment identity.
- Production capture starts only after the preview acceptance artifact, CI, source revision and deployment archive agree.

### AC-8 T-14 transition and failure behavior

T-14 may publish active 0004 only when:

1. snapshot-only source, archive, CI and server metadata identify the same revision;
2. production is owner-only and the persistent fence is frozen under one maintenance ID;
3. complete before evidence passes offline verification;
4. full D1 restore has passed the isolated fault-injection rehearsal;
5. R2 inventory is independently complete;
6. 0004 exactly matches the reviewed pending reset checksum;
7. previous Site version and the temporary full-restore surface are available.

Any failure keeps the fence frozen. The system restores the previous code version and, when D1 differs, performs AC-6 full restore before verifying the complete D1 digest and R2 manifest. Writes reopen only after old-writer smoke passes. Once writes reopen, an old snapshot must never be restored over newer personal data.

## Testing Decisions

- Use fixed Clock, ID, digest and confirmation fakes; test observable behavior rather than incidental SQL strings, except exact migration bytes/checksum and artifact membership.
- Contract tests run against fake D1/R2 ports and Cloudflare-shaped adapters; architecture tests prove every mutation crosses the fence wrapper and maintenance operations are absent from Agent/WebMCP catalogs.
- Concurrency tests cover freeze racing with D1-only and D1+R2 mutations, unresolved/expired leases, revision changes and capture cancellation.
- Evidence tests cover empty/multi-page sources, duplicate rows, unknown objects, cursor repetition, truncation, each numeric bound and deterministic digest.
- Auth tests cover trusted owner/non-owner context, forged headers, wrong Origin/CSRF, cache headers, replay and cross-instance confirmation consumption；另验证专用 evidence payload 不被 response logger 采集，而普通响应无法携带私人内容。
- Restore tests cover every current table/object, interrupted resume, tampering, unsupported schema, non-whitelist corruption and exact before-digest recovery.
- Preview acceptance in AC-7 is required evidence, not replaceable by local mocks；其中必须注入一次发生在两轮 R2 枚举之间的带外对象变化，并证明 capture 失败关闭。

## Out of Scope

- Continuous scheduled backups or a general disaster-recovery product;
- arbitrary SQL export/import, evidence-provided SQL execution or a normal online administration UI;
- downloading or restoring R2 object bodies in this feature;
- changing Site access policy;
- Agent/API service authentication from feature 002;
- applying active 0004, deploying Agent-ready core or reopening production writes in this feature;
- databases exceeding protocol-v1 bounds without a new reviewed protocol;
- long-term retention of the temporary restore surface after T-14 is shipped.

## Further Notes

- 用户确认当前生产个人状态只是测试数据并可丢弃；地点记录保留，真实数据后续统一导入。T-14 仍执行完整备份/恢复标准，以保证这套维护路径将来可用于真实数据。
- Chrome runtime research 与本特性并行，不参与 snapshot evidence，也不能接触本地证据文件。
