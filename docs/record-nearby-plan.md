# Record and Nearby: next PoC work

Checked against the implementation on 2026-09-26. These are scoped next tasks,
not claims that the deployed end-to-end journeys have passed.

## Current support

| Area | Implemented | Gap / not yet accepted |
| --- | --- | --- |
| Personal assessment | Favorite, visited state, personal rating and overall comment | Deployed regression for independence from external ratings and dated visits |
| Visits | Shared Visit composer/history in restaurant detail and Journal; date, rating input, note, multiple photos; edit/delete | The rating input updates the restaurant-level personal assessment, not a separate historical Visit score. Card **Edit** still edits restaurant metadata, not the Visit form |
| Photos | Upload, remove, open viewer, edit optional captions from thumbnails/viewer | Real R2 persistence and partial-upload recovery acceptance; per-photo scores are not implemented |
| Journal | Restaurant/date filters and existing Visit editing | Verify changes from either entry point after reload and failed/repeated submissions |
| Nearby tools | Saved restaurants only, geocoding, straight-line distance, walking evidence, unvisited preference and labelled distance fallback | Current input is only `locationHint`; no Agent interpretation of cuisine/preferences, conversational clarification or images |
| Transit | Domain contract and fallback policy exist | Production composition does not supply a transit provider; do not claim live transit support |
| Entry feasibility | Reservation facts can be displayed | Production walk-in and queue providers explicitly return unknown; no live queue verification |
| Nearby evaluation | 14 synthetic policy cases and a scorer | Not a real Agent benchmark or geographic ground truth; production model is not scored against it |

Code starting points: `apps/web/features/atlas/atlas-screen.tsx`,
`use-atlas-view-model.ts`, `product/application/visits/`,
`product/application/decision/nearby-recommendation-operation.ts`,
`lib/server/application/owner-poc-composition.ts`, and `evals/nearby/`.

## Proposed work packages

Record update (2026-09-26): date-only creation and photo-first recording are now
accepted by both HTTP and application validation. The shared form blocks repeated
submissions after save (including partial photo failure), uses a local default
date and explicitly labels the overall restaurant score. The real deployed API
smoke passed Visit/media persistence, editing, replay and cleanup. Full browser
acceptance and interrupted-upload recovery remain open: constrained Chromium
reported resource exhaustion and crashed. Do not mark R1 complete from the API
smoke alone. Run the opt-in `scripts/record-api-smoke.mjs` and
`scripts/record-browser-smoke.mjs` from `apps/web`; provide `ATLAS_BASE_URL`,
`OWNER_TEST_PASSWORD`, and `ALLOW_RECORD_SMOKE_WRITES=yes`. The browser script
requires Playwright (or `PLAYWRIGHT_MODULE` pointing to its entry). Optional
`RECORD_API_BRIDGE=yes` forwards browser requests to real endpoints through the
runner; report this separately from native browser-network acceptance.

### R1 — Finish the deterministic Record journey

- Keep restaurant metadata editing distinct from **Record a visit**; both the
  detail card and Journal use the same date/note/photo editor and APIs.
- Make personal overall rating, a dated Visit and its note explicit. Do not
  silently overwrite external scores. Current Visit rating input updates the
  restaurant's personal score. A separate historical per-Visit score needs a
  data/API change and an explicit product decision; do not imply it exists.
- Verify caption editing inside the photo viewer and persistent edit/delete.
- Prevent duplicate visits on repeat submissions; failed photo uploads must
  retain the saved Visit and offer retry against that Visit, not create another.
- Per-photo scores require their own storage/API/UI change; optional captions
  are already supported. No Agent is needed for these deterministic actions.

Acceptance: create a dated Visit with several photos, edit date/note/captions,
reload both views, retry a failed upload, and delete a test photo/Visit. Confirm
external scores and unrelated records stay unchanged. Use isolated test data.

### N1 — Establish Nearby gold cases before connecting the Agent

- Independently verify text inputs: short areas, Chinese/Japanese/English
  aliases, ambiguous stations, cuisine constraints, visited/unvisited intent,
  no saved candidates, unavailable routes and unavailable restaurant sources.
- Use fixed saved-catalog and dated route fixtures for repeatable policy tests;
  keep real geography/source checks as a separate live suite.
- Gold outcomes specify clarification versus recommendation, allowed saved
  item IDs, route limits and required uncertainty labels.
- Propose gates: zero out-of-catalog recommendations, zero fabricated route or
  booking facts; all ambiguity/failure safety cases pass; report intent/selection
  accuracy, source coverage, latency and calls/cost separately. Approve the
  dataset and quantitative quality thresholds before claiming acceptance.
- Add screenshot gold cases as a later extension, before enabling vision.

### N2 — Repo-owned Nearby Agent over deterministic tools

- Model interprets location and constraints; deterministic services resolve
  location, query the saved catalog, calculate distance and request routes.
- Use a local distance shortlist before paid route calls. Model cannot invent
  restaurant IDs, distances, opening/queue facts or permission decisions.
- Prefer unvisited places within 10–15 minutes walking. If none, clearly label
  a 2 km straight-line fallback or verified direct transit within 20 minutes
  door-to-door. Transit requires real provider wiring first.
- Return concise reasons plus cuisine, rating provenance, visit state, route
  evidence and reservation caveats. Ask a focused question only for ambiguity.
- Bound tool calls and retries, expose progress, retain usable partial results,
  and distinguish provider failure from a genuine empty result.

### N3 — Real-model and browser acceptance

Run the actual configured model against N1 without exposing gold answers;
retain failures and a compact report. Then test text input, clarification,
saved-place recommendations and route/source failures in the deployed browser.
Image input follows its own benchmark and is not part of the first text PoC.

## Order

The reported Add branch-enrichment regression has a verified deployed preview
fix; broader Add coverage remains open. Finish the Record loop next. R1 and N1
can proceed independently when parallel work is authorized. N2 depends on N1;
N3 validates the integrated result. See [agent handoff](record-nearby-handoff.md).
This document does not authorize or claim those later features as implemented.

## Review retirement

The standalone Review tab, private candidate-list/detail routes and browser
loading logic were removed. Incomplete Add research stays in the Add session
and cannot create a new review candidate through confirmation. Historical
database schema, receipt types and migration/compatibility readers are retained
so existing deployments and audit replay remain readable; they are not a user
workflow. The single legacy production candidate was backed up privately and
removed with its identity binding. All 44 saved records were retained.
