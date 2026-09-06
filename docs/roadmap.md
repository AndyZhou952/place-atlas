# Product Development Roadmap v0.2

Status: active
Last updated: 2026-09-06

The roadmap prioritizes a real data and review loop before adding a 24/7 chat
gateway. Dates are rolling; the product is not coupled to one trip window.

## Completed — Foundation and corrective slice

- private GitHub repository and private hosted map;
- legacy prototype audited without code migration;
- Map, Inbox, and Journal navigation now changes real views;
- browser geolocation drives “Near me” and “Ask nearby” distance ordering;
- five source-checked real records replace demo fixtures;
- Japanese-first titles, Tabelog score/link/check date, official links,
  reservation channel/window notes, and event dates;
- editable title, description, and personal state;
- durable D1 schema for item overrides, discovered items, imports, and journal;
- HTTP and browser-Agent operations share the same application actions;
- Web Access installed for use from the next Codex turn.

## Milestone 1 — Collector proof of concept

Goal: prove that a creator reference can produce a reviewable set of real posts
without manual link-by-link input.

Work:

1. enable remote debugging in a dedicated Chrome or Edge profile;
2. sign a secondary account into Xiaohongshu and Bilibili;
3. connect the local collector worker to persisted `ImportJob` records;
4. run creator discovery for:
   - 在日本摸鱼的小超人 — Rednote ID `274834935`;
   - 漫游东京_tokyotrip — Rednote ID `101943310`;
   - Piggy豚豚酱 — Bilibili UID `697821`;
5. save post metadata and evidence manifests, not just final guesses;
6. process a small smoke batch before scheduling full history.

Exit criteria:

- one queued creator job transitions through collecting to review/completed;
- at least ten posts are discovered without copying links manually;
- rate limits, login expiry, and partial failure are visible;
- no cookie or session secret leaves the dedicated local profile.

## Milestone 2 — Media extraction and review Inbox

Goal: turn video/image posts into fast, auditable restaurant candidates.

Work:

- caption and comment capture;
- audio transcription;
- scene-change/keyframe sampling rather than every-frame OCR;
- Japanese/Chinese/English OCR for signs, menus, receipts, and addresses;
- candidate search and exact-branch resolution;
- side-by-side evidence review with accept, reject, merge, and edit;
- duplicate detection and correction history.

Exit criteria:

- obvious named restaurants auto-confirm with source links;
- uncertain videos land in review with top candidates and evidence frames;
- auto-confirmed exact-branch precision is at least 90% on the smoke set;
- median human review is under 30 seconds.

The agreed 30-item batch (10 per creator) becomes a calibration set after this
pipeline works; it is not a prerequisite for implementation.

## Milestone 3 — Reservation and freshness service

Goal: make each restaurant card actionable and time-aware.

Work:

- refresh Tabelog scores and review counts as dated snapshots;
- discover official, TableCheck, OMAKASE, Tabelog, and phone-only channels;
- model booking horizon, release cadence, cutoff, cancellation policy, and live
  availability separately;
- calculate release reminders in JST;
- re-check high-impact facts before recommending or booking;
- monitor event dates/cancellation and exhibition changes.

Exit criteria:

- every verified restaurant has Tabelog or, outside Japan, Google Maps linkage;
- every reservation claim has source and checked time;
- “earliest bookable” is either computed from an explicit rule or labelled
  unknown—never guessed;
- stale information is visibly warned.

## Milestone 4 — OpenClaw and WeChat vertical slice

Goal: complete the daily loop in a private chat with Andy's main account.

Work:

- isolated OpenClaw deployment with the Tencent Weixin plugin;
- verify required OpenClaw/plugin versions and main-account private chat;
- map WeChat text, image, voice, location, and links to Atlas operations;
- immediate receipt plus asynchronous progress messages;
- scoped service credential, idempotency, audit log, and tool allowlist;
- seven-day reliability/security soak.

Exit criteria:

- “附近有什么” returns sourced results using a shared location;
- creator information queues an import without opening the website;
- title/description edits and journal entries appear on the map immediately;
- restart/retry does not duplicate jobs or writes;
- no unrestricted shell, browser, or database access is reachable from WeChat.

Only after this passes do we rent a 24/7 server. Initial planning target:
2 vCPU, 4 GB RAM, encrypted volume, daily backups; choose region from measured
WeChat latency rather than lowest headline price.

## Milestone 5 — Travel readiness

- photo upload and media gallery;
- phone-first review flow and PWA polish;
- offline-tolerant last-seen data;
- reminder delivery and timezone tests;
- backup/restore rehearsal;
- one-week phone-only use rehearsal.

## Milestone 6 — Portfolio/generalization

Not part of personal v1. Extract interfaces, configuration, generic schemas,
and scrubbed fixtures only after the personal product is reliable. Never expose
Andy's private sources, journal, or social sessions in the public project.

## Immediate next action

Restart Codex so the newly installed Web Access skill is loaded, prepare a
dedicated browser profile, and run a bounded discovery experiment against one
creator. Do not bulk-download all history until the smoke job reports rate-limit
behavior and evidence quality.
