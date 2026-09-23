# T-18 Add monitoring, alerts, and redacted evidence template — draft

- Status: unexecuted template
- Applies to: green owner-poc Add canary, Web switch, Agent switch, and rollback rehearsal
- Privacy default for telemetry and committed evidence: aggregate metrics and opaque correlation references only. Do not retain query/title/address/comment, coordinates, URLs containing user data, provider/raw page bodies, Owner/channel IDs, cookies, signatures, nonces, secret values, D1/R2/resource IDs, object keys, filenames, or screenshots exposing them. This does not change AC34: authoritative intake session storage may contain the Owner-submitted raw query and its NFC/trim-normalized value; Google transient/raw/derived/hash content remains prohibited.

## Metric set

Use bounded operation/provider/outcome labels only. Labels must never contain free text, URL, item/session/receipt value, actor, conversation, or exception message.

### Security and privacy invariants — immediate page / automatic STOP

- Anonymous mutation business-change count: must remain `0`.
- Review Candidate exposure through anonymous Catalog/map/Nearby/personal/media: must remain `0`.
- Legacy direct item POST successful write count: must remain `0`.
- Invalid Agent identity/channel/scope/signature/nonce request with business or provider execution: must remain `0`.
- Model invocation count for canonical `/jpmap` command: must remain `0`.
- Forbidden field/log scan hits for secrets, raw provider/page content, private text, transient Google content, storage keys, and internal IDs: must remain `0`.
- Relay public-route or generic-browser-bypass success: must remain `0`.
- Research phase second-egress count and refunded-spend count: must remain `0`.
- Partial Catalog publication, duplicate strong identity/item, or receipt/result divergence: must remain `0`.

Any non-zero value stops new rollout and invokes the rollback table. Preserve only redacted evidence; do not copy offending content into the incident record.

### Correctness and reliability

- Intake operation totals and outcomes for discover/select/confirm/cancel.
- Sessions by terminal outcome: committed verified, committed needs-review, reused, cancelled, expired, conflict, failed-no-write.
- Confirm replay count, mutation conflict count, Catalog revision conflict count, and `catalog_confirm_receipt_recovery` count. This metric means post-commit acknowledgement loss recovered from the durable receipt; it must not be combined with research transport loss.
- Provider-mode count (`enabled`, `disabled`, `manual/unknown`) by capability.
- Preview refresh count and warning-code totals using the closed warning enum.
- Session expiry and cleanup totals; receipt cleanup totals; cleanup failures.
- Web and Agent normalized-outcome mismatch count: must remain `0` for the smoke corpus.
- Read-after-write failures and public-visibility mismatches.

### Provider health and budget

- Google Places request reservation/use/error totals by approved SKU/outcome only; quota/budget remaining as coarse percentage/band.
- DurableGeocoder gate accepted/rejected, cache hit/miss, resolved/ambiguous/no-match/failure totals.
- Research allowance spent/rejected by phase/reason; signed result accepted/rejected; search/page usage counts; timeout totals; `research_response_loss_spent_unknown` count. Each research response-loss event must retain spent state, resolve to unknown/manual, and have second-egress count exactly 0.
- Provider latency histograms without input labels; application operation latency histograms by operation/outcome.
- Nearby Sidecar metrics remain separately named; do not combine them with Google Places readiness.

### Operational alert suggestions

These are initial canary thresholds, not substitutes for invariants or established SLOs:

- Page immediately on any invariant violation above.
- Pause rollout if five consecutive synthetic Add smokes fail, or if any required smoke row fails once during a switch.
- Pause a provider if its dependency-failure rate exceeds 25% over at least 20 canary attempts; downgrade that capability to manual/unknown.
- Pause rollout if confirm `unexpected_failure` or transaction `failed_no_write` exceeds 1% over at least 100 attempts. With lower PoC traffic, any two consecutive occurrences require review.
- Warn at 70% and disable provider egress at its reviewed hard cap; application hard caps, not alerts, enforce zero overrun.
- Treat absence of telemetry during an active canary as NO-GO, not as success.

## Redacted evidence record

### Release identity

| Field | Redacted value |
|---|---|
| date/time window (UTC) | pending |
| release commit | pending |
| build/config/migration/plugin digests | pending |
| provider-mode manifest digest | pending |
| independent review references | pending |
| operator / verifier role (not personal identifier) | pending |

### Gate status

| Gate | Status | Sanitized evidence reference |
|---|---|---|
| T-08 live deterministic Nearby | pending | pending |
| T-11 dual-entry rollback | pending | pending |
| T-15 / D-P06 | pending; Relay must remain disabled until Accepted | pending |
| T-17 deterministic dual-entry Add | pending | pending |
| append-only migration/seed | pending | pending |
| provider prerequisites | pending | pending |

### Secret-name-only inventory

Record one row per binding. Never add a value/hash/prefix/suffix.

| Component | Secret/binding name | Metadata type | Present | Forbidden extra names absent |
|---|---|---|---|---|
| pending | pending | pending | pending | pending |

### Smoke summary

| Surface | Positive passed/total | Negative passed/total | Business delta expected/actual | Decision |
|---|---:|---:|---|---|
| Anonymous | pending | pending | 0 / pending | pending |
| Owner Web | pending | pending | fixture-specific / pending | pending |
| Agent | pending | pending | fixture-specific / pending | pending |
| Web-only rollback | pending | pending | no reverse migration / pending | pending |
| Agent-only rollback | pending | pending | no reverse migration / pending | pending |

### Provider summary

| Capability | Mode | Contract/preflight result | Aggregate calls/usage | Raw/secret scan hits | Decision |
|---|---|---|---:|---:|---|
| Google Places | pending | pending | pending | must be 0 | pending |
| DurableGeocoder | pending | pending | pending | must be 0 | pending |
| Research Relay | disabled while D-P06 Proposed | pending | pending | must be 0 | pending |
| OpenClaw entry | pending | pending | pending | must be 0 | pending |

### Invariant and alert summary

| Invariant/alert | Observed aggregate | Required | Result |
|---|---:|---:|---|
| anonymous business changes | pending | 0 | pending |
| public Candidate leaks | pending | 0 | pending |
| canonical command model calls | pending | 0 | pending |
| second research egress/refund | pending | 0 | pending |
| partial/duplicate publication | pending | 0 | pending |
| forbidden log/evidence fields | pending | 0 | pending |
| smoke/operational alerts | pending | none unresolved | pending |

### Rollback rehearsal

- Web rollback target inventory irreversible digest / opaque lookup reference: pending
- Web rollback result and post-rollback negative smoke: pending
- Agent rollback target inventory irreversible digest / opaque lookup reference: pending
- Agent rollback result and post-rollback negative smoke: pending
- Old fixture mutation count: must be zero; observed pending
- Green-to-old reverse migration: prohibited; observed none/pending

### Final decision

- Decision: `NO-GO | GO-WEB-CANARY | GO-AGENT-CANARY | GO | ROLLED-BACK`
- Enabled capabilities: pending
- Disabled/manual capabilities and user-visible limitation: pending
- Observation window completed: pending
- Unresolved alerts/findings: pending
- User-visible acceptance reference: pending

Do not mark T-18 complete from this template alone. Completion additionally requires all ticket blockers, independent review, executed smoke/rollback evidence, and HarnessFlow ship acceptance.
