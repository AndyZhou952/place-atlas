# PoC delivery checklist

Updated: 2026-09-26. This checklist tracks the usable product, not repository housekeeping.

- [x] means the stated implementation or verification is complete.
- [ ] means implementation, integration, or acceptance is still pending; the note identifies which.
- Local tests are not production acceptance. All three user journeys must pass on the deployed website before the PoC is ready.

## 1. Add — research a restaurant, confirm, and see it on the map

**Current production blocker (2026-09-26):** owner model settings and a real DeepSeek tool-call check work on Cloudflare. Google branch discovery and no-key Japanese search work, but the matched Tabelog page returns HTTP 403 from the Worker. The Tokyo Mentsudan preview therefore lacks a usable sourced location/rating. No restaurant was confirmed during this test. Add is **not yet accepted**; a reliable permitted source-access path is required before declaring it ready. Missing-coordinate previews disable saving rather than publishing invisible candidates.

- [x] **Core flow in code:** discover → branch selection/clarification → preview → version-bound confirmation; shared publication and duplicate-prevention tests.
- [x] **Repository-owned research foundation:** configurable OpenAI-compatible model, no-key search, bounded tool calls, evidence validation; model has no direct database-write permission.
- [x] **Source-access diagnosis and regression coverage:** same-page checks returned 200 on the development host, 403/high-traffic on Cloudflare, and 403/challenge on the existing Lightsail server. Changing language headers did not resolve Cloudflare access. Read failures now produce explicit preview warnings, not silent missing-information claims.
- [ ] **Reliable deployed source access:** validate an accessible source/search provider from the deployed runtime. Moving to the existing AWS server is not a proven fix. No new research service has been deployed.
- [x] **Targeted rating source reader:** discovered Tabelog main-listing JSON-LD supplies branch identity and aggregate score; review scores are excluded. Three direct development-host page checks returned scores; this is not a DeepSeek or Cloudflare acceptance result.
- [x] **Structured API discovery:** expose discover/select/confirm/cancel with required inputs and owner-session requirements.
- [ ] **Resolve rough hints reliably:** run the actual resolution pipeline against `place-resolution-gold.v1.json`; include short names, romanization, ambiguous chains and no-match cases. The selected-place enrichment smoke is not this benchmark.
- [x] **Enrichment benchmark foundation:** captured-evidence dataset and scorers, source-safety regressions, and a lightweight live rating protocol; always-unknown output cannot pass completion quality.
- [x] **Rating acceptance set:** eight cases (three directly checked restaurant listings, one controlled review-score distractor and four synthetic safety controls), executable scorer and regression tests. No real model success rate has been claimed.
- [x] **Complete Add benchmark contract:** ten mixed-capture cases cover 13 field groups, including coordinates, official/booking links, categories, summary/dishes, ratings and reservation difficulty/lead time. Captures explicitly distinguish synthetic controls from verified webpage facts; summaries require semantic review.
- [x] **Real-model extraction runner:** calls the configured model on frozen evidence without gold answers, records per-field failures and errors, and does not write restaurants. This separate evaluation prompt is not the production Add workflow.
- [x] **DeepSeek full-profile extraction measured:** the corrected Flash v3 run passed 130/130 field states and 88/88 known values across ten cases, with zero unsupported known claims. See [evaluation report](add-evaluation-2026-09-26.md). This is frozen-evidence extraction, not production Add acceptance or semantic summary review.
- [x] **Reservation unknown handling:** a source not listing rules yields unknown; explicit no-reservation policies are represented separately. Regression tests reject a known object containing only `not_stated` values.
- [x] **Owner model settings implemented:** owner-only connection check and encrypted server-side credentials; DeepSeek tested, official OpenAI-compatible endpoint supported. Native Claude/GLM configuration remains outside the first slice.
- [x] **Owner settings live verification:** login, connection check, encrypted save and safe status response passed in Chromium on Cloudflare; the saved key field is cleared and no secret is returned.
- [x] **No-Google discovery fallback implemented:** verified Tabelog listing discovery for Japan and direct listing URLs. No-key search availability is not guaranteed; Google discovery remains preferred when configured.
- [ ] **Live rating benchmark:** independently verify a small set of current aggregate scores and report completion, exact branch/score accuracy, provenance, unavailable sources and latency. Frozen old scores are not live truth.
- [ ] **Complete source research:** read useful restaurant sources beyond snippets; preserve the selected branch and explain source failures without asking for already supplied details.
- [x] **Profile data path implemented and contract-tested:** research → structured preview → validation → D1 → public DTO → list/detail card. Live acceptance is tracked separately below.
  - [x] Name, area, address and coordinates have application fields and an intake path; coordinates remain internal to map/distance calculations.
  - [x] Categories and signature dishes populate visible keywords when supported by branch-matched evidence.
  - [x] Source-grounded description replaces the generic intake message; production composes validated category/area/dish facts, not unconstrained model prose.
  - [ ] Japan: reliably obtain the aggregate Tabelog rating; Google rating is optional. Other overseas places: support Google rating. Mainland China: no external rating required.
  - [x] Official and booking links propagate through research and Add when supported by evidence.
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
