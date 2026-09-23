# T-18 Add anonymous / Owner / Agent smoke matrix — draft

- Status: planning template; no live probe is claimed
- Rule: use synthetic restaurant/query/note data approved for test. Evidence contains sanitized outcome, status, count delta, receipt/audit correlation, and timestamp only.
- Release unit: every row must identify the same commit, build/config digest, migration manifest, provider-mode manifest, and OpenClaw plugin digest.

## Common assertions

- Only `catalog.intake.discover/select/confirm/cancel` reaches Add; legacy direct item POST remains fail closed.
- AC34 permits the Owner-submitted raw query and its NFC/trim-normalized value in the authoritative intake session. The persistence prohibition below applies to Google transient content, provider raw response, derived summary, and transient-content hash—not to that Owner input.
- Google Places presentation is response-only. Of Google-derived candidate data, durable state contains only the allowed Place identity tuple; separately allowed Owner input/server state includes AC34's raw and NFC/trim-normalized query. No Google transient/raw/derived/hash content enters session/receipt/log/prompt/D1/R2.
- `committed_verified` may enter anonymous Catalog/map/Nearby. `committed_needs_review` is Owner-only, may carry Owner Visit data, and never enters anonymous Catalog/map/Nearby/personal/media projection.
- Same confirm replays one receipt/item with no extra Catalog revision. Conflict and dependency failure produce no partial write.
- When Relay is disabled, research fields are manual/unknown and Add remains usable; no hidden egress occurs.

## Anonymous Web

| Probe | Expected result | State assertion |
|---|---|---|
| Read public Catalog/map/Journal/media fixture | Allowed only through Public Read v1 | Closed DTO only; no Candidate, internal ID, key, hash, receipt, audit, or private evidence |
| Call each intake operation without Owner Cookie | Stable unauthenticated failure | Zero session, receipt, Catalog revision, D1/R2, or provider-use delta |
| Call legacy direct item POST | Fail closed | Zero business/provider delta |
| Forge Web conversation/session/version | Rejected before mutation/provider use | Zero accepted-activity extension and zero write |
| Read known Review Candidate and its Visit/media | Not found/unauthorized under public projection | No existence or personal-memory leakage |
| Submit cross-origin write/login request | Same-origin/auth policy rejection | Zero Cookie/business change |

## Authenticated Owner Web

| Probe | Expected result | State assertion |
|---|---|---|
| Wrong password, then valid login | Wrong credential fails; valid credential creates hardened finite session | Password never logged/persisted; session names only in evidence |
| Only-name discover with provider available | At most three stable candidates or clarification | Transient Google name/address absent from durable state and logs |
| Only-name discover with discovery disabled/failing | Safe dependency/manual path | No inferred durable fact; Owner can continue only through supported manual path |
| Select with durable proposal | Preview shows provenance/license/time and unknowns | No Catalog write before confirm |
| Select with geocoder unavailable | Preview/clarification retains Owner input | manual/needs-review remains available; no fabricated coordinates |
| Research disabled | Tabelog/reservation are manual/unknown | Zero Relay allowance/egress |
| Research enabled after D-P06 acceptance | Only closed scalar evidence is shown | One phase allowance, bounded usage, no raw body/storage/log |
| Cancel and repeated cancel | Stable cancelled result/replay | No Catalog write; terminal behavior stable |
| Confirm verified fixture and retry same confirm | One item/receipt/revision; replayed response | Public item appears only after atomic commit |
| Confirm insufficient/conflicting evidence | `committed_needs_review` or refreshed conflict preview | Candidate Owner-visible only; no public/map/Nearby leak |
| Concurrent/different-session duplicate confirm | Reuse or revision conflict according to policy | One identity/item; no duplicate revision or partial rows |
| Session expiry boundary | Exact expired result at 30 minutes inactivity | Invalid/poll calls do not renew activity |
| Log out / rotate session version | Old Cookie deterministically fails | Existing data unchanged; no provider use |

## Authenticated Agent / OpenClaw

| Probe | Expected result | State assertion |
|---|---|---|
| Owner DM `/jpmap add <query>` | Deterministic discover, zero model calls | Correct project/scope/conversation; one sanitized audit |
| `/jpmap add select <n>` | Same preview semantics as Web | Same operation contract, no adapter-local business rule |
| `/jpmap add confirm` and post-commit response-loss retry | Same item/receipt recovered through `catalog_confirm_receipt_recovery` | No second publication and no unrelated provider phase |
| Research RPC response is lost after phase spend | Preview falls back to unknown/manual and records `research_response_loss_spent_unknown` | Phase remains spent; research second-egress count is exactly 0 |
| `/jpmap add cancel` and replay | Stable cancel result | No Catalog write |
| Bare confirm without active session | Only recent committed receipt recovery where allowed | Never replays an older receipt over a newer active session |
| Second sender / group / thread / wrong channel | Rejected before Worker egress | Zero provider/model/audit business mutation |
| Wrong scope / key / signature / expired timestamp | Stable gateway rejection | Zero operation/provider execution |
| Nonce replay | Unauthorized replay rejection | No duplicate operation or audit success |
| Unknown slash / ordinary assistant message | Not treated as Add | No Atlas credential/tool or state change |
| Runtime/model tool inventory | Only reviewed native command path | No model-selectable Atlas, shell, repository, Cloudflare, D1/R2, maintenance, or reset tool |
| Restart between preview and confirm | D1 restores authoritative session | Same version/digest rules and receipt recovery |

## Web/Agent equivalence

Run the same synthetic scenarios through each adapter and compare normalized operation outcomes, not presentation text:

1. candidate ordering and `hasMore`;
2. clarification fields/order;
3. preview evidence/provenance/freshness/warning order;
4. cancel/expiry/conflict behavior;
5. confirm outcome, item identity, receipt replay, and visibility;
6. provider-disabled manual/unknown fallback.

Any difference in business outcome is NO-GO. Channel-specific wording, ARIA behavior, and WeChat formatting may differ.

## Independent switch and rollback assertions

Exact Web/Agent rollback targets are resolved only from a controlled non-repository operator inventory. This committed matrix records only the inventory's irreversible digest and opaque lookup reference; it never records the target URL, endpoint, key, resource ID, or credential value.

| Web | Agent | Required assertion |
|---|---|---|
| old/read-only | old/read-only | Baseline remains readable; no Add claim |
| green | old/read-only | Web Add may work; Agent remains previous behavior and cannot reach green Add |
| old/read-only rollback | green | Agent Add may work; Web clearly degrades to old read-only and does not display green writes |
| green | green | Both share green D1 and equivalent operations |
| green rollback | green | Agent remains healthy; Web rollback does not rotate/revoke Agent credential |
| green | Agent rollback | Web remains healthy; Agent rollback does not alter Web bindings/session secret |

For each transition, record aggregate row/revision/receipt counts before and after. A rollback must not copy green writes into the old fixture, mutate old resources, or claim edit continuity.

## Result record

| Field | Value |
|---|---|
| release commit / artifact digests | pending |
| provider mode manifest digest | pending |
| migration manifest result | pending |
| anonymous matrix | pending |
| Owner matrix | pending |
| Agent matrix | pending |
| Web-only rollback | pending |
| Agent-only rollback | pending |
| sanitized evidence path | pending |
| rollback inventory digest / opaque reference | pending |
| operator decision | NO-GO (draft) |
