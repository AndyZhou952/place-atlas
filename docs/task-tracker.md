# Japan Atlas Task Tracker

Status: active execution board
Last updated: 2026-09-06

## Stage definitions

| Stage | Meaning | Exit signal |
|---|---|---|
| Experimental | Resolve architecture and platform uncertainty with bounded real tests | One complete creator-to-map and visit-to-map loop works |
| Demo | Core loops work end to end with manual safeguards | Agent, media, review, search, and map memory work together |
| Formed | Reliable enough for daily personal use | Seven-day WeChat soak, backups, and stable mobile experience |
| Delivery | Ready for the Japan stay and portfolio documentation | Phone-only rehearsal and restore test pass |

**Current overall stage: Experimental.** The product has a real deployed core,
not a fake mock-up, but its intended daily interface is not connected yet.

Status vocabulary: `done`, `in progress`, `next`, `blocked by dependency`, and
`later`.

## Completed foundation

| ID | Task | Status | Evidence / acceptance |
|---|---|---|---|
| FND-01 | Private repository and owner-only hosted site | done | Source and production deployment exist |
| FND-02 | Durable structured storage | done | D1 schema/migrations; edits, jobs, and visits survive sessions |
| FND-03 | Framework-neutral API boundary | done | Website and browser Agent tools use the same HTTP operations |
| DATA-01 | Remove placeholder restaurant fixtures | done | Map contains only source-checked bootstrap records |
| PLACE-01 | Japanese-first title and source-backed details | done | Tabelog/official/reservation/event facts display with links |
| MAP-01 | Basic map, place selection, and geolocation sort | done | Five verified records render and can be distance-sorted |
| DOC-01 | Initial architecture, ingestion, evaluation, and ADR set | done | Repository documents decisions and open risks |

## Current correction slice

| ID | Priority | Task | Status | Acceptance |
|---|---:|---|---|---|
| CLEAN-01 | P0 | Remove the three test museum visits and one test import job | done | Production tables contain none of those rows |
| DOC-02 | P0 | Establish Agent-first / map-first product boundary | done | Product design v0.3 and architecture agree |
| UX-01 | P0 | Replace per-entry ratings with one optional place rating | next | `null` is valid; one rating per item |
| UX-02 | P0 | Replace standalone Journal list with place-level memory | blocked by UX-01 | Repeat visits form a timeline; one place card |
| MEDIA-01 | P0 | Add image upload and one-line per-image captions | blocked by UX-01 | Images persist, retain captions, and appear in map detail |
| SEARCH-01 | P1 | Add partial/fuzzy multilingual and tag search | next | Misspellings/partial terms and tags return sensible records |
| REC-01 | P1 | Add visited/unvisited filtering and recommendation default | blocked by UX-01 | “Unvisited” is derived from visits and preferred by default |

## Ordered implementation plan

### 1 — Personal memory data model

| ID | Task | Status |
|---|---|---|
| DATA-02 | Add `place_assessments` with nullable persistent rating | next |
| DATA-03 | Migrate `journal_entries` into rating-free `visits` | next |
| DATA-04 | Derive visit count, last visit, and visited state | next |
| DATA-05 | Add idempotency and audit fields to personal writes | next |

Exit: one place supports no rating, one rating, and multiple ordered visits
without duplicate cards.

### 2 — Map-first reading and organization

| ID | Task | Status |
|---|---|---|
| MAP-02 | Add visited/unvisited marker styles and filters | blocked by DATA-04 |
| MAP-03 | Show personal rating, visit count, timeline, and thumbnails in selected-place detail | blocked by DATA-02/03 |
| MAP-04 | Remove permanent Inbox/Journal top navigation after Agent parity | blocked by AGENT-03 |
| REVIEW-01 | Add contextual evidence-review deep link/sheet | blocked by ACQ-03 |
| SEARCH-02 | Show editable tags/aliases on result and detail cards | next |
| SEARCH-03 | Implement weighted partial/fuzzy search | blocked by SEARCH-02 |

### 3 — Photo storage and captions

| ID | Task | Status |
|---|---|---|
| MEDIA-02 | Enable R2 binding and media metadata tables | blocked by DATA-03 |
| MEDIA-03 | Validate MIME, size, dimensions, and content hash | blocked by MEDIA-02 |
| MEDIA-04 | Upload/finalize/attach/caption API | blocked by MEDIA-03 |
| MEDIA-05 | Web detail fallback uploader and gallery | blocked by MEDIA-04 |
| MEDIA-06 | Agent image intake mapping | blocked by AGENT-02/MEDIA-04 |

### 4 — Agent application layer

| ID | Task | Status |
|---|---|---|
| AGENT-01 | Extract application ports/use cases from the current server store | next |
| AGENT-02 | Implement typed v2 tools for search, visits, rating, tags, and media | blocked by DATA/MEDIA |
| AGENT-03 | Add service authentication, idempotency, authorization, and audit log | blocked by AGENT-01 |
| AGENT-04 | Add natural-language filter/ranking adapter | blocked by AGENT-02 |

### 5 — Dedicated-browser acquisition experiment

| ID | Task | Status |
|---|---|---|
| ACQ-01 | Create isolated Chrome/Edge profile and secondary-account login | next; user setup |
| ACQ-02 | Run bounded creator discovery for 小超人 | blocked by ACQ-01 |
| ACQ-03 | Persist posts, evidence, extraction states, and review candidates | blocked by AGENT-01/ACQ-02 |
| ACQ-04 | Add captions/comments, ASR, keyframes, and OCR | blocked by ACQ-03 |
| ACQ-05 | Calibrate exact-branch precision, then expand to the other two creators | blocked by ACQ-04 |

Do not bulk-import a full history until the smoke batch exposes rate limits,
login expiry, duplicates, and evidence quality.

### 6 — OpenClaw / WeChat

| ID | Task | Status |
|---|---|---|
| WX-01 | Prove main-account private-chat text/media/location round trip | blocked by AGENT-02 |
| WX-02 | Map WeChat inputs and receipts to Agent operations | blocked by WX-01/AGENT-03 |
| WX-03 | Run restart, retry, duplicate-delivery, and seven-day soak tests | blocked by WX-02 |
| CLOUD-01 | Select and rent the 24/7 host from measured latency/cost | blocked by WX-01 |

### 7 — Delivery readiness

| ID | Task | Status |
|---|---|---|
| OPS-01 | Daily backup and tested restore | later |
| OPS-02 | Phone-first and offline-tolerant review | later |
| OPS-03 | Reservation/event freshness reminders in JST | later |
| QA-01 | One-week phone-only travel rehearsal | later |
| PORT-01 | Extract a scrubbed reusable core for portfolio use | later; post-personal-v1 |

## Next checkpoint

Before the next implementation slice, confirm only decisions that change the
schema or user experience materially:

1. whether the persistent personal rating uses half-star increments (assumed
   0.5–5) or another scale;
2. whether photo captions are plain one-line text only in v1 (recommended);
3. whether a visit note may also be empty (recommended: yes when photos exist).

All other current requirements are specific enough to proceed.
