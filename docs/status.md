# PoC delivery checklist

Updated: 2026-09-26. This checklist tracks the usable product, not repository housekeeping.

- [x] means the stated implementation or verification is complete.
- [ ] means implementation, integration, or acceptance is still pending; the note identifies which.
- Local tests are not production acceptance. All three user journeys must pass on the deployed website before the PoC is ready.

## 1. Add — research a restaurant, confirm, and see it on the map

- [x] **Keita failure regression:** selected-name source discovery, six controlled post-selection cases, research progress and truthful incomplete status. Deployed preview verified location, category, rating and reservation; cancelled without saving. See [incident and boundaries](add-keita-regression.md).
- [x] **Frontend ambiguity refinement:** mobile browser tests passed for Torikizoku + Shinjuku west exit, AFURI + Roppongi (two branches), and Tokyo Mentsudan + Shinjuku. Name retained, new query/session token used, stale results cleared, multi-match choice required. Six search sessions cancelled without restaurant writes; this is discovery/selection acceptance, not six full Add completions.
- [ ] **Full profile and broad acceptance:** richer grounded overview/dishes and repeated live reliability. Basic preview success does not close these gates.
- [x] **Grounded dish extraction:** Keita live research now retains two sourced dishes despite Japanese quote punctuation; per-dish validation drops unsupported additions without discarding supported dishes. Summaries combine validated cuisine, area, dishes and reservation policy. Wider menu coverage remains part of broad acceptance.
- [x] **Regional source compatibility:** accept legitimate seven- and eight-digit Tabelog listing IDs while still excluding review pages. The Aomori Strauss listing now parses its category successfully; 41 reader/research/discovery tests passed after the change.
- [x] **Save-result layout fix:** receipt details are collapsed and long identifiers wrap within shrinkable grid columns. Deployed frontend tested at 320/390/768/1440 px with a simulated 320-character receipt, both collapsed and expanded; no horizontal overflow. The layout test intercepted Add responses and made no database writes. Typecheck, lint, 49 targeted tests and 102 broader source/publication/catalog tests passed; backend confirmation semantics are unchanged.
- [x] **Existing restaurant baseline enrichment:** public readback confirms all 42 restaurants have descriptions and category tags; 28 have known reservation information. Six existing profiles were preserved and 36 were enriched. Personal-history tables were not modified. See [catalog enrichment report](catalog-enrichment-report.md) for sources, the timestamp correction and limitations; named dishes and booking lead times remain incomplete where evidence is unavailable.

**Current production status (2026-09-26):** the Tokyo Mentsudan live Add journey passed: Cloudflare + DeepSeek research, confirmed publication, duplicate-safe replay, and refreshed browser list/detail/map display with Tabelog 3.54 and its sourced profile. Source access, candidate promotion and catalog validation fixes are deployed. This is one real journey, not full restaurant coverage; broader live resolution/coverage benchmarks and reader quota reliability remain open.

- [x] **Core flow in code:** discover → branch selection/clarification → preview → version-bound confirmation; shared publication and duplicate-prevention tests.
- [x] **Repository-owned research foundation:** configurable OpenAI-compatible model, no-key search, bounded tool calls, evidence validation; model has no direct database-write permission.
- [x] **Source-access diagnosis and regression coverage:** same-page checks returned 200 on the development host, 403/high-traffic on Cloudflare, and 403/challenge on the existing Lightsail server. Changing language headers did not resolve Cloudflare access. Read failures now produce explicit preview warnings, not silent missing-information claims.
- [x] **Cloudflare-native browser adapter:** optional bounded, fixed-source Browser Run reader shared by discovery and research; ordinary reads remain first. API-success challenge pages, wrong-listing evidence, oversized responses and aborted requests are rejected in tests. No external server or browser-service credential is introduced.
- [x] **Deployed source-access smoke:** Firecrawl's anonymous scrape endpoint read the actual Tokyo Mentsudan (3.54) and Yotsuya Takeda (3.71) listings from Cloudflare, including address/coordinates; deployed DeepSeek produced useful Mentsudan previews. `RESTAURANT_SOURCE_READER=firecrawl` selects this reader. No additional server or paid-reader credential was used. Anonymous limits and long-term availability remain unverified.
- [x] **Alternative-reader investigation:** mobile/map pages, Kitesurf, anonymous Jina and anonymous Microlink did not supply usable Worker evidence; Firecrawl did. HTTP-200 challenge detection and provider failures are covered by tests. See [source-access handoff](add-source-access-handoff.md) for results, limitations and continuation instructions.
- [x] **Previously invisible candidate fix:** a complete confirmed preview promotes the matching review candidate using its existing ID, with atomic snapshots/publication/receipt/revision and duplicate-safe replay. Existing public restaurant records are not overwritten. Targeted reader/publication/catalog/composition checks passed 90 tests, plus typecheck and lint; the previous unfinished full-suite run is not claimed as passing.
- [x] **Researched-record visibility fix:** the catalog validator now accepts validated enriched profiles, Agent-observed coordinates and explicit no-reservation evidence. Older validation silently omitted these valid records after successful writes. Regression coverage now reads the published profile through the actual catalog filter, not only the public DTO projector.
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
- [x] **Live Add acceptance — initial case:** Tokyo Mentsudan passed useful sourced preview → confirmation → public catalog and refreshed browser list/detail/map → duplicate-safe replay. Existing item ID was preserved; catalog count rose from 41 to 42, with exactly one matching item. Browser reported no page errors. A refreshed preview required a second explicit confirmation; changed evidence was not silently accepted.
- [ ] **Broader Add acceptance:** run new restaurants, already-saved restaurants, ambiguous chains, short/romanized names and source failures through the same deployed journey. One successful restaurant does not close this coverage gate.

## 2. Record — deterministic personal history, no Agent required

Next scoped tasks and code-audited gaps: [Record and Nearby plan](record-nearby-plan.md).

- [x] **Data/API foundation:** personal rating, favorite/visited state, Visit date/note, photo upload and caption-update operations exist.
- [x] **Journal editing in code:** edit Visit date/rating/note and update photo captions; local state/API tests exist.
- [x] **Photo viewer editing in code:** thumbnail and opened-photo views expose caption editing. Persistence and failure recovery still need live acceptance.
- [ ] **Per-photo scores:** not implemented; separate from optional captions and restaurant-level personal rating.
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
