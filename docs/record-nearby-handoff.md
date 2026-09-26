# Agent handoff: finish Record, benchmark Nearby, release the PoC

Updated: 2026-09-26.

## Goal and working boundaries

Japan Atlas is a personal restaurant map: research and add a restaurant with
minimal typing, record visits and memories, and recommend nearby saved places.
The next priority is a complete **Record** journey, followed by a benchmark-led
**Nearby** Agent. Do not treat passing unit tests as a launch-ready product.

The application and repository-owned Agent run on Cloudflare; D1 stores records
and R2 stores photos. Users configure their own OpenAI-compatible model settings
and optionally Google Maps services. Model reasoning must not decide permissions
or bypass deterministic validation and explicit Add confirmation. Do not introduce
external chat-platform dependencies, Harness Flow, or new product/features
planning directories. Keep documentation in English under `docs/`.

Live website: https://japan-atlas-owner-poc.japan-atlas-poc.workers.dev/

## Read first

1. Root `README.md`: setup, secrets, deployment and website usage.
2. `docs/status.md`: implementation versus acceptance checklist.
3. `docs/record-nearby-plan.md`: audited capabilities and scoped work packages.
4. `docs/add-selected-chain-regression.md` and `docs/add-keita-regression.md`:
   selected-place failures, fixes and limitations.

Start by checking the working tree and deployment revision. Preserve unrelated
changes and existing personal data. Read credentials only from ignored local
configuration or server secrets; never copy them into reports or Git.

## What works now, and what is not proven

- Add has discovery, branch selection/refinement, bounded source research,
  structured preview, confirmation and duplicate-safe publication. A real Tokyo
  Mentsudan save was verified through the refreshed map. Keita and Torikizoku
  selected-branch previews were also verified; this is not broad Add acceptance.
- Tabelog access from Workers remains a source-availability risk. The current
  source reader and bounded recovery improve coverage but cannot guarantee every
  listing. Never invent missing scores, coordinates or booking rules.
- The standalone Review workflow is removed. Incomplete location research stays
  in Add and cannot publish a hidden candidate. One legacy candidate was backed
  up and deleted; the last checked catalog retained 44 records, including 42
  restaurants. Historical migrations and audit compatibility remain intentionally.
- Personal controls, Visit editing, Journal, photo uploads and caption editing
  exist. Their complete deployed Record journey still needs acceptance.
- Nearby currently uses deterministic saved-catalog, location and walking tools,
  not model-driven intent interpretation. Transit contracts exist but are not
  wired in production. Queue and walk-in availability are unknown.

## First: complete Record without an Agent

Latest progress: date-only/photo-first creation, local default dates, explicit
overall-score wording and repeated-submit guards are deployed. Real API
persistence/edit/delete/replay checks passed. The remaining priority is browser
acceptance and interrupted-upload recovery, not rewriting existing Visit APIs.
The test browser ran out of resources and crashed; see the current status and
opt-in smoke scripts documented in `docs/record-nearby-plan.md`.

Use `apps/web/features/atlas/atlas-screen.tsx`,
`use-atlas-view-model.ts`, and `apps/web/product/application/visits/`.
The detail card and Journal already share Visit components and APIs. Keep one
underlying record; make restaurant metadata editing and recording a visit clear.

Important: the Visit form's rating currently updates the restaurant's overall
personal score. It is **not** a separately stored historical Visit rating. Label
this honestly; do not silently expand the schema. Optional photo captions exist;
per-photo scores are not required for this slice.

Exercise an isolated test Visit end to end on the deployed website:

- Create a dated Visit with a note and multiple photos.
- Edit the date, note and photo captions from the card and Journal; open photos
  and verify both views after reload.
- Check personal-rating changes preserve Tabelog/Google scores.
- Test repeated submission and interrupted upload; retry against the saved Visit
  without duplicating it or losing successful photos.
- Delete only the test photo/Visit, verify persistence and authorization, and
  leave existing memories untouched.

Fix failures before marking Record accepted. Record actual browser results and
any untested D1/R2 or privacy boundaries in `docs/status.md`.

## Then: build the Nearby benchmark before the Agent

Inspect `apps/web/evals/nearby/`: its 14 synthetic policy cases are a useful seed,
not independent geographic truth or a real-model result. Extend with verified
short multilingual location hints, ambiguous stations, cuisine constraints,
visited preferences, no saved matches, and provider failures. Keep a fixed saved
catalog and dated route evidence for repeatability; separate live-source checks.

Each gold case should state input/context, expected action (clarify or recommend),
allowed saved-place IDs, route limits and required uncertainty disclosures. Score
clarification and selection accuracy, unsupported claims, source coverage, latency
and tool calls/cost separately. Require zero invented restaurants, route times or
booking facts; set and document the remaining quality thresholds before testing.
Show the dataset and benchmark report to the user before claiming acceptance.

After the benchmark is ready, connect the repository-owned model to deterministic
catalog, geocoding, distance and route tools. Shortlist locally before paid route
calls. Recommend saved restaurants only, prefer unvisited places within 10–15
minutes walking, and label a 2 km straight-line fallback clearly. Do not advertise
transit until a real provider is wired and tested. Screenshot input is a later
benchmark-backed extension, not a dependency for the text PoC.

Starting points: `apps/web/product/application/decision/`,
`apps/web/lib/server/application/owner-poc-composition.ts`, and `apps/web/agent/`.
Use bounded calls/retries, visible progress and truthful partial failures. Evaluate
the actual model without supplying gold answers; preserve concise failure reports.

## Release gate

Run targeted tests, typecheck and lint, then deployed browser acceptance for Add,
Record and Nearby. Confirm map visibility after writes, duplicate safety, photo
persistence, owner-only private access and recovery from unavailable providers.
Retain curated benchmarks and compact reports, not redundant raw JSON runs.
The PoC is ready only when these user journeys pass—not merely when their APIs
return success. Existing Add resolution gold and live enrichment coverage remain
open and must not be relabelled complete while working on Record/Nearby.
