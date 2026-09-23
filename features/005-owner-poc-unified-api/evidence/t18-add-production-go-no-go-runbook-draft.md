# T-18 Add production go/no-go and staged rollout runbook — draft

- Status: draft only; no production action has been performed
- Scope: T-18 Add production provider preflight, blue/green release, independent Web/Agent switching, and rollback
- Authority: `spec.md` AC28–32 and AC33–46, `architecture.md`, `tickets.md` T-18, and D-P06
- Evidence rule: record names, counts, digests, timestamps, and sanitized outcomes only; never record secret values, private queries, provider bodies, Owner identifiers, or infrastructure identifiers

## Current decision

T-18 is **NO-GO** until every hard blocker below is closed. Preparing or reviewing this runbook does not close a blocker and does not authorize a deploy.

| Hard blocker | Required closure evidence |
|---|---|
| T-08 | Current owner-poc endpoint/key is tested through real OpenClaw/WeChat owner and negative probes, with zero-model evidence and correlated sanitized Worker audit. |
| T-11 | Permanent OpenClaw switch and an actual independent rollback rehearsal are complete. Web and Agent rollback remain separate. |
| T-15 | Research allowance, Relay transport, Tunnel identity, SSRF/rebinding defenses, single-egress semantics, and threat review pass. Until then D-P06 remains Proposed and Relay must be disabled. |
| T-17 | Deterministic Web and `/jpmap add` E2E passes, including all negative identities/scopes and the reviewed four-operation Agent manifest. |

T-15 is a direct prerequisite of T-17 even though T-18 lists T-08, T-11, and T-17 as its immediate blockers. T-18 cannot bypass that dependency graph.

## GO conditions

Proceed only when all items are evidenced against one immutable release candidate:

- Commit, build artifact, OpenClaw plugin archive, migration manifest, configuration digest, and operation manifest are pinned.
- The independent code/security reviews for T-15 and T-17 are PASS with no unresolved serious/general findings.
- Append-only owner-poc migrations replay from an empty database and apply to the green database; schema/migration journal and seed manifest match the reviewed digests.
- Green D1/R2/Worker are isolated. The old fixture and current rollback deployment remain readable and unchanged.
- Public projection, Owner authentication, Add state/CAS/publication, and Agent gateway contract suites pass on the release candidate.
- Provider preflight outcomes are recorded using the provider checklist. A failed optional provider is explicitly disabled and maps to manual/unknown or `needs_review`; it is never silently enabled.
- D-P06 is Accepted only after its stated preflight and independent threat review. If it is still Proposed, Research Relay is disabled and the production plan explicitly selects manual/unknown.
- Anonymous writes and the legacy direct item POST fail closed; no probe changes D1/R2, receipt counts, or Catalog revision.
- An operator, observation window, and stop authority are recorded before switching either entry point. Exact independently reversible Web and Agent rollback targets live only in a controlled, non-repository operator inventory; committed evidence records only an irreversible inventory digest and opaque lookup reference.
- Persistence inspection distinguishes allowed Owner input from forbidden provider content: AC34 permits the Owner-submitted raw query and its NFC/trim-normalized value in the intake session. The prohibition applies to Google transient name/address/coordinates, raw response, derived summary, and transient-content hash.
- All previously exposed test credentials have been rotated before real private data is used.

## Immediate NO-GO / STOP conditions

Stop before or during rollout on any of the following:

- Any hard blocker is open, evidence belongs to a different commit/configuration, or a review is not PASS.
- Migration is destructive, out of order, not replayable, or changes the old fixture.
- A secret value, provider response body, Owner query, Owner identity, D1/R2 identifier, object key, or raw page content appears in logs or committed evidence. This evidence/log redaction rule does not prohibit AC34's allowed Owner raw and NFC/trim-normalized query in authoritative session storage.
- Public/Owner projection leaks a Review Candidate or its Visit/media; anonymous mutation causes any business change.
- Google transient content is persisted, logged, placed in a receipt/prompt, or rendered into Leaflet.
- Durable location lacks valid `sourceUrl`, `license`, and `checkedAt`, or the global rate/cache/attribution/provider-switch contract cannot be shown.
- Research Relay is reachable publicly, has an unreviewed browser-fetch bypass, can egress twice for one phase, needs product credentials/storage, or cannot enforce A+AAAA/IP pin/SNI/redirect/rebinding defenses.
- Agent manifest exposes save/update/delete, Record, media, destructive, maintenance, reset, shell, GitHub, Cloudflare management, D1, or R2 capability.
- Web or Agent cannot be rolled back independently, or rollback is described as preserving new green writes in the old fixture.

## Staged rollout

### Stage 0 — freeze and observe

1. Freeze the reviewed release candidate and record only its non-secret digests.
2. Capture pre-change health/count baselines using aggregate, non-private queries.
3. Confirm the old fixture remains reachable in read-only mode. Resolve exact rollback targets from the controlled non-repository operator inventory; record only its irreversible digest and an opaque lookup reference in repository evidence.
4. Classify each provider as `enabled`, `disabled`, or `manual/unknown`; no implicit default is allowed.
5. Run the smoke matrix against local/isolated fixtures. A failure leaves both production entry points unchanged.

### Stage 1 — inactive green data plane

1. Apply the reviewed append-only migrations to green owner-poc only.
2. Verify migration journal, constraints, cleanup schedules, seed count/digest, and zero unexpected rows.
3. Verify D1 session/receipt/revision invariants and R2/public-media boundaries without entering private content in evidence.
4. Keep production composition and Agent manifest closed while provider preflights run.

Rollback: abandon the green release candidate. Do not modify or delete old resources and do not reverse-migrate green writes.

### Stage 2 — provider and composition preflight

1. Run Google Places and DurableGeocoder checks from the prerequisite checklist.
2. Select exactly one Research mode:
   - `relay_enabled`: only if T-15 and D-P06 acceptance evidence is complete;
   - `relay_disabled_manual_unknown`: required while D-P06 is Proposed or any Relay guarantee fails.
3. Verify production composition resolves each configured adapter and fails closed when its binding is absent.
4. Confirm legacy direct POST remains closed and only `catalog.intake.discover/select/confirm/cancel` can reach Catalog intake.

Rollback: disable only the failed provider/composition capability. Basic Add may continue with Owner input and `needs_review`; do not reinterpret missing evidence as verified.

### Stage 3 — Web canary and switch

1. Deploy the green Worker without changing OpenClaw.
2. Run anonymous and Owner Web smoke against green, including only-name/manual fallback, preview/cancel, one confirmed verified or needs-review fixture, read-after-write, replay, and public-visibility rules.
3. Observe the agreed canary window. Confirm no private/raw content in logs and no invariant/security alert.
4. Switch/retain the public Web entry only after the Web column is GO. Agent continues to use its prior endpoint.

Web rollback: resolve the exact old read-only URL/version from the controlled operator inventory and return only the Web entry. State clearly that editing is degraded and green writes are not copied back. Leave Agent unchanged; repository evidence retains only the inventory digest/opaque reference.

### Stage 4 — Agent canary and switch

1. Provision a fresh scoped Agent credential and the reviewed T-17 manifest; do not reuse the old read-only scope as proof of Add authorization.
2. Install/activate the pinned plugin archive through the approved host procedure and verify runtime version, command shape, empty model tool exposure, and exact scopes.
3. Temporarily target green and run owner plus negative Agent smoke. Correlate sanitized request/receipt/audit identifiers and prove zero model invocation for canonical commands.
4. Exercise discover → select → preview → cancel, then a separate discover → select → preview → confirm flow. Verify replay and read-after-write.
5. Switch the permanent Agent endpoint only after its column is GO; observe before retiring the temporary path.

Agent rollback: resolve the exact previous endpoint/key/plugin manifest from the controlled operator inventory, restore only that Agent target, and confirm read-only `/jpmap nearby` behavior. Leave Web on green if its smoke remains healthy. Never claim Add or green-write continuity through the old fixture; repository evidence retains only the inventory digest/opaque reference.

### Stage 5 — rollback rehearsal and closeout

1. Rehearse Web rollback and restoration without changing Agent.
2. Rehearse Agent rollback and restoration without changing Web.
3. Repeat the negative smoke rows after restoration and verify new green data was not reverse-migrated.
4. Complete the monitoring/evidence template, attach independent review, and obtain user-visible acceptance before checking T-18.

## Rollback decision table

| Signal | Action | Unaffected surface |
|---|---|---|
| Web auth/public projection/Add UI failure | Roll back Web only; preserve green for diagnosis | Agent endpoint remains unchanged |
| Agent identity/scope/plugin/presenter failure | Roll back Agent only | Healthy Web remains green |
| Google Places failure/policy uncertainty | Disable discovery; manual input/needs-review only | Existing Catalog, Owner Web, Nearby |
| DurableGeocoder failure/policy uncertainty | Disable geocoder; manual location or needs-review | Discovery and existing Catalog |
| Relay/Tunnel/D-P06 failure | Disable Relay; manual Tabelog/reservation or unknown | Add core and other providers |
| D1 publication, migration, privacy, or authorization invariant failure | Stop both new write entry points and return to old read-only surfaces | Old fixture remains unchanged |

Rollback is a routing/configuration recovery, not data reversal. Green data is retained for controlled diagnosis unless a separately reviewed retention procedure authorizes cleanup.
