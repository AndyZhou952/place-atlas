# PoC delivery checklist

Updated: 2026-09-26. This checklist tracks the usable product, not repository housekeeping.

- [x] means the stated implementation or verification is complete.
- [ ] means implementation, integration, or acceptance is still pending; the note identifies which.
- Local tests are not production acceptance. All three user journeys must pass on the deployed website before the PoC is ready.

## 1. Add — research a restaurant, confirm, and see it on the map

- [x] **Core flow in code:** discover → branch selection/clarification → preview → version-bound confirmation; shared publication and duplicate-prevention tests.
- [x] **Repository-owned research foundation:** configurable OpenAI-compatible model, no-key search, bounded tool calls, evidence validation; model has no direct database-write permission.
- [x] **Structured API discovery:** expose discover/select/confirm/cancel with required inputs and owner-session requirements.
- [ ] **Resolve rough hints reliably:** run the actual resolution pipeline against `place-resolution-gold.v1.json`; include short names, romanization, ambiguous chains and no-match cases. The selected-place enrichment smoke is not this benchmark.
- [x] **Enrichment benchmark foundation:** captured-evidence dataset and scorers, source-safety regressions, and a lightweight live rating protocol; always-unknown output cannot pass completion quality.
- [ ] **Live rating benchmark:** independently verify a small set of current aggregate scores and report completion, exact branch/score accuracy, provenance, unavailable sources and latency. Frozen old scores are not live truth.
- [ ] **Complete source research:** read useful restaurant sources beyond snippets; preserve the selected branch and explain source failures without asking for already supplied details.
- [ ] **Complete the data path:** research → structured preview → validation → D1 → list/detail card for all fields below.
  - [x] Name, area, address and coordinates have application fields and an intake path; coordinates remain internal to map/distance calculations.
  - [ ] Categories and signature dishes: populate visible keywords. Existing `tags` is currently empty on Add publication.
  - [ ] One-sentence source-grounded description: replace the generic intake message.
  - [ ] Japan: reliably obtain the aggregate Tabelog rating; Google rating is optional. Other overseas places: support Google rating. Mainland China: no external rating required.
  - [ ] Official and booking links: propagate the existing `officialUrl`/`sources` fields through research and Add.
  - [ ] Reservation policy and explicit lead time: prefer the correct branch's official source, use Tabelog as fallback. Existing advance-days/release-window fields still need automated population.
- [ ] **Independent external-Agent access:** authenticated structured-proposal integration using the same validation and confirmation services; dedicated agent-token authentication is not implemented.
- [ ] **Live Add acceptance:** useful sourced preview → owner confirms → same restaurant visible in list/map after refresh → retry creates no duplicate. An unknown-only preview or review-only candidate is not success.

## 2. Record — deterministic personal history, no Agent required

- [x] **Data/API foundation:** personal rating, favorite/visited state, Visit date/note, photo upload and caption-update operations exist.
- [x] **Journal editing in code:** edit Visit date/rating/note and update photo captions; local state/API tests exist.
- [ ] **Unify card and Journal entry points:** the card Edit currently edits basic item fields, not the full Visit form. Both entry points must operate on the same restaurant/Visit records without duplicate writes.
- [ ] **Photo interaction acceptance:** click/open an uploaded photo, edit its optional description, save, reopen, and verify persistence.
- [ ] **Rating independence:** changing personal score must preserve Tabelog/Google scores and historical Visit records; verify in the deployed browser.
- [ ] **Live Record acceptance:** create and edit a dated Visit with notes and multiple captioned photos, refresh, and verify D1/R2 state and both views. No LLM dependency on this path.

## 3. Nearby — Agent understanding and recommendations over saved restaurants

- [x] **Deterministic foundation:** saved-catalog lookup, straight-line distance, location resolution/route adapters, fallback policies and local tests.
- [x] **Offline policy benchmark seed:** 14 synthetic cases plus a scorer cover saved-only choices, walk/transit/distance rules, visited preference, clarification and source failures; this is not live Agent acceptance.
- [ ] **Agent benchmark first:** curate multilingual short-location, intent, ambiguity, visited preference, walk/transit fallback and provider-failure cases. An initial synthetic policy suite is not a live quality result.
- [ ] **Screenshot benchmark:** add labelled map screenshots with ground-truth location/ambiguity before enabling image-based location recognition.
- [ ] **Connect the Agent:** interpret the location and constraints, ask only necessary clarification, call catalog/location/route tools, and explain recommendations.
- [ ] **Preserve recommendation rules:** recommend only saved restaurants; default to unvisited, walking within 10–15 minutes; if none, broaden to a clearly labelled 2 km distance fallback or direct transit within 20 minutes door-to-door. Never present straight-line distance as verified walking time.
- [ ] **Entry feasibility:** source walk-in/reservation information; unknown availability or queues remain explicitly unknown. Do not claim an unsourced wait time.
- [ ] **Live Nearby acceptance:** score real Agent predictions against the approved benchmark, then verify a browser query yields useful saved-place recommendations and truthful route/entry caveats.

## 4. Map, storage and authorization — shared deterministic foundation

- [x] **Storage/runtime code:** Cloudflare application, D1 catalog/personal records/Visit/session data, R2 media, and shared write coordination exist.
- [x] **Owner authorization code:** owner-session protection for writes and private reads; public catalog/display responses remain separate.
- [x] **Map and personal controls in code:** map rendering, favorite, visited and edit controls exist.
- [ ] **Data boundary audit:** verify intended public fields versus private notes/media/session/audit data and that anonymous callers cannot access private records or write.
- [ ] **Real deployment validation:** verify the intended writable personal D1/R2 bindings, migrations, retained data, map markers and media persistence; fixture-only tests do not establish this.
- [ ] **Session and audit coverage:** verify Add/Agent session retention and audit coverage for all accepted write paths.
- [ ] **Regression acceptance:** Add, Record and Nearby read the same saved catalog and personal state; updates are visible consistently after refresh.

## 5. PoC release gate

- [ ] All three live user journeys above pass on Cloudflare; implementation-only checks do not close these gates.
- [ ] Real DeepSeek resolution predictions pass the existing resolution gates; enrichment and Nearby have separate factual-quality reports.
- [ ] No invented identity, score, route time or booking rule; failed providers are not reported as empty search results or successful completion.
- [ ] Owner auth, confirmation, retries, photo persistence and map visibility pass integration/browser checks.
- [ ] A new user can follow the root README from API configuration and owner secrets through deployment and first successful use.

## Immediate execution order

1. Make Add research and its field-to-database path useful; evaluate resolution against the existing gold dataset and enrichment separately.
2. Prepare the Nearby benchmark before wiring its Agent. In parallel-capable work, finish deterministic Record integration and browser tests.
3. Validate all three paths on the deployment, then close the release gates.

Detailed evaluation protocol and the latest limited live observation are in `docs/ingestion-and-evaluation.md`. Keep raw runs in ignored `evals/runs/`; retain curated gold data, schemas, test fixtures and concise accepted reports. Repository cleanup is not a product milestone.
