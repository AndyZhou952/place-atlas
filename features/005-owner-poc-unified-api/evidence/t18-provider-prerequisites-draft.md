# T-18 provider and runtime prerequisite checklist — draft

- Status: unexecuted checklist
- Secret handling: evidence may contain exact **secret names and types only**. It must never contain values, partial values, fingerprints derived from values, command history containing values, Owner/channel IDs, account/resource IDs, or screenshots that reveal them.
- Missing, unreviewed, or ambiguous configuration fails closed. Do not infer readiness from a provider returning one successful response.

## Shared evidence header

- [ ] Release commit/build/config/migration/plugin digests are pinned.
- [ ] Environment is the isolated green owner-poc environment; the old fixture is unchanged.
- [ ] Secret inventory was obtained through metadata/name-only output and redacted before storage.
- [ ] Logs and committed evidence were scanned for secret values, raw provider bodies, Owner queries, transient Google content, page text, and Owner identifiers; all counts are zero. This redaction rule does not prohibit AC34's Owner raw query plus NFC/trim-normalized query in authoritative intake session storage.
- [ ] Each capability has an explicit `enabled | disabled | manual/unknown` mode in the reviewed provider-mode manifest.

## Google Places discovery

Purpose: transient candidate discovery/refetch and durable Place ID identity only. It is not the durable address/coordinate source and must not feed Leaflet.

- [ ] The exact production secret binding name is frozen by reviewed T-18 code/config. Record that name and `secret_text` type only; do not assume or copy the Nearby Sidecar name without review.
- [ ] The key is server-side only and absent from browser/Agent DTO, bundle, logs, D1/R2, prompt, receipt, evidence body, and OpenClaw host.
- [ ] Required Places API/SKU is enabled and the key has the reviewed API restriction. The application restriction uses a provider-supported server-workload restriction where available; otherwise an independently reviewed compensating control (least-privilege secret placement, fixed adapter endpoint/method/field mask, quotas, monitoring, and rotation) is evidenced. Do not claim path-level key restriction unless the provider actually supports and enforces it.
- [ ] Provider quota and billing budget/alert are configured for the PoC; expected maximum calls per intake and stop behavior are documented.
- [ ] Endpoint, method, field mask, redirect behavior, response-size/time limits, and attribution display are fixed by contract.
- [ ] Of Google-derived candidate data, session persistence contains only `{providerNamespace, placeId, ordinal, createdAt}`. Separately allowed Owner/server state includes AC34's Owner raw and NFC/trim-normalized query; no Google transient name/address/coordinates/raw JSON/derived summary/hash is persisted.
- [ ] Top-3 stable ordering, no pagination/systematic enumeration, refetch identity match, malformed response, quota, missing key, and provider failure contracts pass.
- [ ] Provider policy/terms review covers transient display, Place ID storage, attribution, and retention. Any unresolved term sets discovery to disabled/manual.

Evidence fields: secret name/type; API/SKU enabled boolean; restriction class; quota/budget guard boolean; contract counts; sanitized attribution/policy revision; outcome.

## DurableGeocoder / production durable location

Purpose: propose persistable address/coordinates with OSM-compatible provenance. Google Geocoding is not this source.

- [ ] Provider identity and official endpoint are explicit and server controlled.
- [ ] If public Nominatim is selected, one Owner action directly triggers each query; no autocomplete, batch, scheduled, systematic, or details scraping path exists.
- [ ] Global D1 gate enforces no more than 1 request/second across the application and concurrent callers.
- [ ] Shared cache behavior, damaged-cache failure, TTL/retention, and provider replacement switch are contract-tested.
- [ ] Identifying User-Agent or HTTPS Referer is configured without embedding personal/secret data.
- [ ] Persisted known location always has valid `sourceUrl`, `license`, and `checkedAt`; UI/public projection shows attribution/license/time.
- [ ] Unknown/no-match/ambiguous/malformed/rate-limited/network failure preserves Owner input and yields clarification or `needs_review`, never fabricated coordinates.
- [ ] A disabled provider produces zero network use and leaves the manual/needs-review path usable.

Evidence fields: provider label; endpoint class (not credentials/query); identity configured boolean; gate/cache/switch contract counts; provenance projection result; mode.

## Research Relay / D-P06

Purpose: optional Owner-directed, single-intake Tabelog/official reservation scalar research. It is never required for basic Add.

**Mandatory status rule:** while D-P06 is Proposed, or if any item below is unproven, set `relay_disabled_manual_unknown`. Do not deploy or expose the Relay. T-18 may still publish basic Add only after its other blockers close.

- [ ] T-15 implementation, preflight, independent threat review, and D-P06 acceptance are complete for this exact artifact/configuration.
- [ ] T-15 freezes the exact Worker-side allowance/result verification secret names, host-side corresponding secret names, and Tunnel identity binding names. Evidence lists those names/types only; this draft deliberately does not invent them.
- [ ] Relay is reachable only through the protected Tunnel/auth path; public origin and generic browser-fetch bypass are absent.
- [ ] Relay has no D1, R2, Owner Cookie/password/session secret, Agent HMAC, Catalog write credential, or persistent product-data store.
- [ ] D1 atomically spends the entire phase before RPC; initial budget is at most 1 search + 3 pages + 35s, confirm is 0 search + 2 pages + 25s, and budgets cannot borrow.
- [ ] Failure, timeout, or retry never refunds allowance or causes a second egress. Research response loss after spend records `research_response_loss_spent_unknown`, returns unknown/manual, and has second-egress count exactly 0. A repeated request returns rejection/replay defense, not another fetch.
- [ ] Allowance tamper, expiry, requestId replay, digest mismatch, unsigned/malformed scalar result, and usage overflow fail closed.
- [ ] Hardened transport is HTTPS:443 only; rejects credentials/IP literal/other scheme or port/metadata host, validates A+AAAA public addresses, pins connection IP while preserving TLS SNI/Host, revalidates each of at most three redirects, and covers DNS rebinding.
- [ ] OpenClaw search can supply URL candidates only. Canonical pages are fetched only by hardened Relay transport.
- [ ] Raw search/page/HTML/review text/images are discarded immediately and never enter logs, storage, prompt/memory, response, or evidence.

Evidence fields: D-P06 status; review reference/digest; secret and binding names/types; public-bypass result; allowance/SSRF test counts; aggregate usage; raw-retention scan; mode.

## OpenClaw host and Agent entry

- [ ] T-08 and T-11 live gates are closed, including real owner/negative probes and an independent rollback rehearsal.
- [ ] OpenClaw is the reviewed pinned version and host preflight passes Node and `node:sqlite` checks.
- [ ] Plugin archive digest and manifest digest match T-17 review; runtime shows the native `jpmap` command and no model-selectable Atlas tool.
- [ ] Host configuration metadata contains only the required names: `JPMAP_AGENT_ENDPOINT`, `JPMAP_AGENT_KEY_ID`, `JPMAP_AGENT_HMAC_SECRET`, `JPMAP_OWNER_ACTOR_ID`, and `JPMAP_OWNER_CONVERSATION_ID`. Evidence records presence only, never values.
- [ ] Matching Worker metadata contains reviewed Agent key/secret names (currently `AGENT_JPMAP_KEY_ID` and `AGENT_JPMAP_HMAC_SECRET`) and only the T-17-approved scopes.
- [ ] The operation manifest exposes exactly the reviewed Nearby and four intake operations appropriate to the release; no Record/media/destructive/maintenance/reset or infrastructure tool is visible.
- [ ] Owner DM identity/channel/direct/no-thread checks occur before Worker egress; second sender/group/thread/wrong scope/nonce replay tests have zero business/provider mutation.
- [ ] Endpoint/key switch and exact rollback targets are recorded independently from Web routing in a controlled non-repository operator inventory; rotation of one surface does not alter the other. Repository evidence stores only the inventory's irreversible digest and opaque lookup reference.
- [ ] Service-identity-only secret storage and service environment permissions are evidenced by mode/owner metadata only: system-level systemd uses root-owned storage, while the current user-level systemd deployment uses a protected-directory, service-account-owned `0600` environment file.

Evidence fields: version strings; package/config digests; required-name presence booleans; scope/operation names; zero-model counter; sanitized positive/negative result counts; rollback result.

## Existing Owner and Nearby names that may appear in name-only evidence

- Owner Worker: `ATLAS_OWNER_PASSWORD`, `ATLAS_OWNER_SESSION_SECRET`, `AGENT_JPMAP_KEY_ID`, `AGENT_JPMAP_HMAC_SECRET`.
- Private Nearby Route Sidecar: `GOOGLE_MAPS_API_KEY` only. This Sidecar remains separate from Add and does not prove Google Places readiness.
- OpenClaw client: the five `JPMAP_*` names listed above.

Any new T-15/T-18 secret name must first appear in reviewed code/config; it must not be guessed in an operator document.
