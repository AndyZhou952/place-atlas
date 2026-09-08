# Japan Atlas Task Tracker v0.4

Status: active execution board
Last updated: 2026-09-08

## Stage definitions

| Stage | Meaning | Exit signal |
|---|---|---|
| Experimental | Resolve architecture and integration uncertainty with bounded real tests | One creator-to-map and visit-with-photo-to-map loop works |
| Demo | Core loops work end to end with manual safeguards | Agent, media, review, search, and map memory work together |
| Formed | Reliable enough for daily personal use | Seven-day WeChat soak, backups, and stable mobile experience |
| Delivery | Ready for the Japan stay and portfolio documentation | Phone-only rehearsal and restore test pass |

**Current overall stage: Experimental.** The persistent web core is real; the
creator collector, photo pipeline, service-secured Agent, and WeChat channel are
not yet complete.

Cross-milestone delivery is tracked in [RFC roadmap #3](https://github.com/AndyZhou952/jp-food-event-map/issues/3).

Status vocabulary: `done`, `in progress`, `next`, `blocked`, and `later`.

## Timeline and dependency board

Only genuine prerequisites are listed. A blank prerequisite means the task can
be scheduled independently within its phase.

### 0 — Foundation and product boundary

| ID | Parent task | Subtask / deliverable | Prerequisite | Status | Stage |
|---|---|---|---|---|---|
| FND-01 | Repository | Private repository and clean new-code baseline | — | done | Experimental |
| FND-02 | Hosting | Owner-only hosted site and preview workflow | FND-01 | done | Experimental |
| FND-03 | Persistence | D1 schema, immutable migrations, durable API | FND-01 | done | Experimental |
| DATA-01 | Trusted data | Remove demo/test rows and keep source-checked bootstrap records | FND-03 | done | Experimental |
| DOC-01 | Product model | Agent-first/map-first boundary, architecture, roadmap, ADRs | — | done | Experimental |
| DOC-02 | Interaction governance | Maintain UI control/API/Agent parity contract | DOC-01 | done | Experimental |

### 1 — Correct personal memory and map interaction

| ID | Parent task | Subtask / deliverable | Prerequisite | Status | Stage |
|---|---|---|---|---|---|
| DATA-02 | Place memory | `place_assessments`: one nullable 0–5 rating per place | FND-03 | done | Experimental |
| DATA-03 | Place memory | Repeatable `visits`; require at least rating, note, or photo | FND-03 | done | Experimental |
| DATA-04 | Place memory | Visit count/order and visits-imply-visited derivation | DATA-03 | done | Experimental |
| UX-01 | Personal controls | Persistent icon-only favourite and visited controls in detail and collection rows | DATA-02 | done | Experimental |
| UX-01A | Personal controls | Optimistic local feedback with durable reconciliation and rollback | UX-01 | done | Experimental |
| UX-02 | Journal correction | One place card with one rating and a visit timeline, also visible in map detail | DATA-02, DATA-03 | done | Experimental |
| UX-03 | Rating input | Journal defaults to 3 with 0.5 steps; inline `マイスコア` edit uses the ViewModel | DATA-02 | done | Experimental |
| UX-03A | Rating normalization | Accept any typed 0–5 value and round consistently to one decimal in UI, API, and Agent tools | UX-03 | done | Experimental |
| UX-02A | Journal correction | Edit/delete a Visit with confirmation; filter history by place and inclusive date range | UX-02 | done | Experimental |
| UX-05 | Combined filters | Visit and favourite controls can be active together and require both selected states | SEARCH-02 | done | Experimental |
| UX-06 | Collection readability | Move rating badges into the right rail and reveal full titles on selection, hover, or focus | UX-05 | done | Experimental |
| CI-01 | Continuous integration | Pull requests and `main` run formatting, lint, type checks, unit tests, and production build | UX-05 | done | Experimental |
| UX-04 | Deletion | List delete, named confirmation, cascading personal cleanup, tombstone | FND-03 | done | Experimental |
| SEARCH-01 | Deterministic search | Partial multilingual name/description/tag matching | — | done | Experimental |
| SEARCH-02 | Search transparency | Visible tags and all/visited/unvisited/favourite filters | SEARCH-01, DATA-04 | done | Experimental |
| MAP-01 | Interactive map | Multi-marker pan/zoom, marker selection, fit bounds | — | done | Experimental |
| MAP-02 | Map-dominant layout | Collection collapses by default; floating search opener | MAP-01 | done | Experimental |
| MAP-03 | Layout selection | Select split sidebar (B) and make it the main default | MAP-02 | done | Experimental |
| MAP-04A | Map performance | Reuse markers, remove blocking selection animation, and eliminate moving-canvas filters/blur | MAP-01 | done | Experimental |
| MAP-04B | Map performance | Restore progressive Leaflet tile scheduling, isolate a replaceable map adapter, reconcile markers by key, and validate hosted behavior ([#1](https://github.com/AndyZhou952/jp-food-event-map/issues/1)) | MAP-03 | in progress | Experimental |
| PERF-01 | Journal performance | Create/edit/delete each use two D1 round trips; editors/dialogs close optimistically while the roughly 2s platform/auth response completes in the background ([#2](https://github.com/AndyZhou952/jp-food-event-map/issues/2)) | DATA-03 | done | Experimental |
| DATA-05A | Write reliability | Client-supplied Visit mutation ID, idempotent insert, atomic Visit/assessment write | DATA-03 | done | Experimental |
| DATA-05 | Write reliability | Idempotency keys, audit events, recoverable delete policy | DATA-02, DATA-03 | next | Experimental |
| REFACTOR-01 | View structure | Split selected layout into focused view components | MAP-03 | next | Experimental |

### 2 — Photo upload and captions

| ID | Parent task | Subtask / deliverable | Prerequisite | Status | Stage |
|---|---|---|---|---|---|
| MEDIA-01 | Object storage | Private R2 binding and D1 media metadata/migration | DATA-03 | done | Experimental |
| MEDIA-02 | Upload safety | MIME/signature/size/hash validation and rollback cleanup are done; server-side dimensions and orphan sweeper remain | MEDIA-01 | in progress | Experimental |
| MEDIA-03 | Media model | Ordered Visit photos, private content route, optional normalized one-line caption | MEDIA-01 | done | Experimental |
| MEDIA-04 | Web fallback | Same-form Visit photos; 24-file selection split into four-file requests; later add/retry, caption, delete through ViewModel | MEDIA-03, MAP-03 | done | Experimental |
| MEDIA-05 | Map memory | Visit-grouped photos/captions; four-thumbnail preview plus keyboard/button/swipe lightbox | MEDIA-03 | done | Experimental |
| MEDIA-06 | Agent intake | Capture-session association, channel-message idempotency, ambiguity confirmation, photo/reply captions (RFC #4) | MEDIA-03, AGENT-02, AGENT-03 | blocked | Demo |

### 3 — Framework-neutral Agent application layer

| ID | Parent task | Subtask / deliverable | Prerequisite | Status | Stage |
|---|---|---|---|---|---|
| AGENT-01 | Core boundary | Extract application ports/use cases from D1 store | DATA-05 | next | Experimental |
| AGENT-02 | Typed tools | Search, recommend, visits, rating, tags, preferences, media | AGENT-01, MEDIA-03 | blocked | Experimental |
| AGENT-03 | Service security | Authentication, authorization, idempotency, audit receipts | AGENT-01, DATA-05 | blocked | Experimental |
| AGENT-04 | Natural language | Convert requests to structured filters/ranking with explanations | AGENT-02 | blocked | Demo |
| AGENT-05 | Navigation cleanup | Remove permanent Inbox/Journal only after Agent write parity | AGENT-02, MEDIA-06 | blocked | Demo |

Current browser Agent bridge already exposes editing, preferences, rating,
visit create/update/delete, import queueing, and nearby lookup as a working
precursor. It is not a substitute for the authenticated 24/7 service boundary.

### 4 — Dedicated-browser creator acquisition

| ID | Parent task | Subtask / deliverable | Prerequisite | Status | Stage |
|---|---|---|---|---|---|
| ACQ-01 | Browser setup | Isolated Chrome/Edge profile and secondary-account login | — | next; user setup | Experimental |
| ACQ-02 | Smoke collection | Fetch a bounded 小超人 batch and persist raw post evidence | ACQ-01, AGENT-01 | blocked | Experimental |
| ACQ-03 | Extraction | Caption/comments, ASR, sampled keyframes, multilingual OCR | ACQ-02 | blocked | Experimental |
| ACQ-04 | Identity resolution | Candidate search, exact branch evidence, abstention/review | ACQ-03 | blocked | Experimental |
| ACQ-05 | Review UI | Contextual evidence review and confirm/reject operations | ACQ-04 | blocked | Demo |
| ACQ-06 | Calibration | 10 小超人 + 10 漫游东京 + 10 Piggy precision set | ACQ-04 | blocked | Demo |
| ACQ-07 | Creator import | Expand to full history only after rate-limit/duplicate checks | ACQ-06 | blocked | Demo |

### 5 — OpenClaw and WeChat

| ID | Parent task | Subtask / deliverable | Prerequisite | Status | Stage |
|---|---|---|---|---|---|
| WX-01 | Channel proof | Main-account private-chat text/media/location round trip | AGENT-02 | blocked | Demo |
| WX-02 | Command adapter | Map messages, receipts, progress, and clarification to use cases | WX-01, AGENT-03 | blocked | Demo |
| WX-03 | Media flow | Photos and captions from WeChat appear under the right visit | WX-02, MEDIA-06 | blocked | Demo |
| WX-04 | Reliability | Retry, duplicate delivery, restart, and seven-day soak | WX-02 | blocked | Formed |
| CLOUD-01 | 24/7 host | Select region/provider from measured latency, cost, and reliability | WX-01 | blocked | Formed |
| CLOUD-02 | Operations | Deploy pinned runtime, secrets, monitoring, encrypted backups | CLOUD-01, AGENT-03 | blocked | Formed |

### 6 — Delivery and later generalization

| ID | Parent task | Subtask / deliverable | Prerequisite | Status | Stage |
|---|---|---|---|---|---|
| OPS-01 | Data safety | Daily backup and tested restore | CLOUD-02 | blocked | Formed |
| OPS-02 | Travel UX | Phone-first, weak-network, and last-seen behavior | MAP-03 | later | Formed |
| OPS-03 | Freshness | Reservation/event re-checks and JST reminders | AGENT-03 | later | Formed |
| QA-01 | Rehearsal | One-week phone-only travel rehearsal | WX-04, OPS-01, OPS-02 | blocked | Delivery |
| PORT-01 | Portfolio core | Scrub private data and extract reusable adapters/config | QA-01 | later | Delivery/post-v1 |

## Current checkpoint

The split-sidebar layout is selected. Journal correction, free-form rating
normalization, and foreground mutation-latency fixes are deployed and hosted-
verified. Map performance remains tracked in issue #1. The next independent
engineering checkpoint is to finish the remaining `MEDIA-02` hardening, then
extract the `AGENT-01` application boundary before the dedicated-browser
collector begins.
