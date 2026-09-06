# Product Development Roadmap v0.3

Status: active
Last updated: 2026-09-07

The product is currently in the **experimental stage**. Its database, private
map, source-backed records, and API are real; its intended daily Agent channel,
media pipeline, creator collector, and consolidated place memory are not yet
complete. See `task-tracker.md` for task-level status and dependencies.

## Completed — durable foundation

- private GitHub repository and owner-only hosted map;
- legacy prototype audited without becoming the new code baseline;
- source-checked real records with Japanese-first titles;
- dated Tabelog/reservation facts, official links, and event dates;
- D1 persistence for edits, import jobs, and the first visit prototype;
- shared HTTP and browser-Agent operations;
- Web Access installed for the dedicated-browser experiment;
- architecture split between channels, Agent, core product, and acquisition.
- one persistent optional personal rating per place and repeatable rating-free
  visit records;
- persistent favourite and visited state, destructive place removal with a
  confirmation boundary, and tombstones for bootstrap records;
- interactive multi-marker map, collapsible place drawer, visible tags, and
  deterministic partial/tag search;
- browser Agent tools for preferences, rating, visits, and deletion using the
  same APIs as the web UI.
- icon-only favourite/visited controls in both place detail and the collapsible
  collection, with immediate optimistic feedback and failure rollback;
- marker reuse and lighter map compositing for substantially faster pan, zoom,
  selection, and personal-state changes;
- live A/B/C presentation URLs from one main build and one database;
- inline personal/Tabelog rating comparison with one consolidated source-check
  date at the bottom of place detail.

## Phase 1 — correct the personal-memory model

Goal: make one place remain one place across repeated visits.

- complete the selected-place timeline integration and empty-state polish;
- make `hasVisited` derivation and manual override semantics explicit;
- add idempotency and audit records to personal writes;
- evaluate the three map-layout branches and select one UI direction;
- extend deterministic fuzzy search with aliases and tested ranking fixtures.

Exit: a museum can have three visits, zero or one overall rating, and one place
detail containing all notes without duplicate place cards.

## Phase 2 — photos and captions

Goal: make personal visual memory durable and visible on the map.

- configure R2-compatible object storage;
- add media metadata, upload state, visit relation, ordering, and content hash;
- accept common phone image formats with size/type validation;
- allow optional one-line captions per image;
- show visit-grouped thumbnails and a gallery in map detail;
- support web upload as a fallback and Agent upload as the primary path.

Exit: images sent through either supported surface appear under the correct
place and visit with captions after refresh.

## Phase 3 — Agent application layer

Goal: make WeChat able to operate the product without direct database access.

- extract framework-neutral use cases from the current store;
- add typed operations for search/recommendation, visits, persistent rating,
  tags, and media;
- require service authentication, idempotency, authorization, and audit events;
- translate natural language into structured filters while preserving sources;
- default nearby recommendations toward unvisited places unless asked otherwise.

Exit: a non-WeChat test adapter can execute every daily workflow and the map
updates immediately.

## Phase 4 — dedicated-browser acquisition experiment

Goal: prove creator-level collection before bulk import.

1. use an isolated Chrome/Edge profile and secondary social accounts;
2. run a small discovery batch for 在日本摸鱼的小超人;
3. persist post metadata and evidence rather than only final guesses;
4. add captions/comments, ASR, sampled keyframes, and multilingual OCR;
5. resolve exact branches with sources and send uncertainty to review;
6. calibrate on the agreed creators only after the smoke loop works.

Exit: one creator reference yields at least ten reviewable posts, partial
failures remain visible, and auto-confirmed exact-branch precision reaches at
least 90% with abstention.

## Phase 5 — OpenClaw and WeChat

Goal: make Andy's private chat the primary input and command surface.

- verify main-account private-chat text, image, voice, link, and location flows;
- map messages to the same Agent operations used by the test adapter;
- return immediate receipts plus asynchronous progress;
- deep-link ambiguous visual review to the relevant map context;
- test retries, duplicate delivery, restarts, and seven-day reliability;
- remove permanent Inbox/Journal navigation only after feature parity.

Exit: daily capture, nearby unvisited recommendations, edits, visits, photos,
and import requests work from WeChat and appear on the map.

Only after the message round trip is proven should a 24/7 server be rented.
Start planning around 2 vCPU, 4 GB RAM, encrypted storage, and daily backups;
choose region from measured latency and operating reliability.

## Phase 6 — formed product and delivery

- reservation/event freshness and JST reminders;
- phone-first layout and offline-tolerant last-seen data;
- backup/restore rehearsal;
- one-week phone-only travel rehearsal;
- security and cost review;
- scrubbed architecture/demo material for the later portfolio version.

Exit: the personal product is dependable for the Japan stay. Generalization is
explicitly post-v1 and never exposes Andy's private sources, photos, or journal.

## Immediate sequence

1. review the three live map-layout variants and select the presentation;
2. add object storage, photo captions, and upload APIs;
3. implement Agent v2 service security, idempotency, and audit records;
4. prepare the dedicated browser and run the bounded 小超人 experiment;
5. build the OpenClaw/WeChat adapter;
6. select cloud hosting only after the local channel proof succeeds.
