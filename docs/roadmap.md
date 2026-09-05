# Product Development Roadmap

Status: proposed
Last updated: 2026-09-05

The ordering optimizes for a reliable tool before the Japan stay, while keeping
bulk historical ingestion as a parallel value experiment rather than a blocker.
Calendar dates will be added after the trip year and departure date are confirmed.

## Milestone 0 — Decisions and evidence pilot

Estimated effort: 3–5 focused days.

Deliverables:

- approve product brief, architecture, accuracy definition, and privacy model;
- reconnect GitHub and audit the previous `food-map` repository;
- initialize the private repository and decision log;
- define core schemas and `AgentRuntime`/connector contracts;
- create 3–6 representative smoke cases from the named creators to validate the
  evidence contract without delaying the product foundation;
- prove one WeChat text/image/location round trip without broad agent tools.

Exit criteria:

- one message can become a sourced inbox item;
- one known place can be confirmed and displayed on a temporary map;
- the smoke cases prove the extraction seam and human-review fallback;
- WeChat integration risk is known before we build around it.

## Milestone 1 — Durable map core

Estimated effort: 5–8 focused days.

Deliverables:

- Postgres/PostGIS schema and migrations;
- private authentication/allowlist;
- map/list/detail/inbox views;
- place, event, source, reservation claim, visit, review, and media records;
- manual/CSV/JSON import and complete export;
- duplicate merge and correction history;
- seeded Tokyo sample data.

Exit criteria:

- the product remains useful with the agent and social connectors disabled;
- nearby and map-bounds queries are tested;
- all identity and reservation claims retain provenance.

## Milestone 2 — Daily WeChat assistant

Estimated effort: 5–7 focused days plus a seven-day soak.

Deliverables:

- pinned OpenClaw deployment and WeChat plugin;
- scoped tools for capture, nearby search, confirmation, and visit logging;
- immediate inbox receipt and asynchronous enrichment status;
- text, image, voice, and location flows;
- action confirmation and audit log;
- recovery, monitoring, backup, upgrade, and rollback runbooks.

Exit criteria:

- runtime gates in the evaluation plan pass;
- Andy can complete the normal daily loop without opening an admin console;
- no unrestricted host/browser access is available from WeChat.

## Milestone 3 — Identity and reservation enrichment

Estimated effort: 8–12 focused days, adjusted by pilot results.

Deliverables:

- evidence manifests, ASR, keyframe OCR, candidate search, and entity resolver;
- the agreed 30-item calibration batch: ten items each from `小超人`,
  `漫游东京`, and `Piggy` where the source archives permit;
- calibrated auto-confirm/abstain policy;
- fast top-three review card;
- Tabelog/official/booking-source reservation enrichment;
- source freshness and contradiction handling;
- 150-item gold dataset and reproducible evaluation runner.

Exit criteria:

- >=90% exact entity+branch precision among auto-confirmed items on holdout;
- >=95% top-three recall for determinable reviewed items;
- median human review <=30 seconds;
- high-impact reservation claims are sourced and freshness-aware.

## Milestone 4 — Historical import

Estimated effort: source-dependent; time-box each connector to 2–4 days before
reviewing value.

Deliverables:

- discovery-only imports for the three named seed creators;
- Andy's relevance-selection queue;
- deep enrichment only for selected Tokyo-relevant posts;
- optional X bookmarks and YouTube metadata import;
- connector health and rate-limit reporting;
- secondary-account/dedicated-profile operating guide.

Exit criteria:

- bulk discovery saves more manual time than it consumes;
- failures cannot corrupt confirmed places;
- share-to-inbox and manual import remain fully functional fallbacks.

## Milestone 5 — Travel readiness

Estimated effort: 3–5 focused days plus real-world use.

Deliverables:

- reservation release calculations and reminders in JST;
- event expiry/cancellation checks;
- stale-hours warning before leaving;
- mobile/PWA polish and offline-tolerant last-seen data;
- encrypted backups and disaster-recovery rehearsal;
- cloud region/VPS choice based on measured latency and WeChat stability.

Exit criteria:

- a phone-only rehearsal covers capture, recommend, navigate, and review;
- reminders survive restart and timezone boundaries;
- restore from backup has been tested;
- a one-week soak produces no unexplained message loss.

## Milestone 6 — Personal memory and later extraction

Not required for the first travel-ready release.

Deliverables:

- personal taste profile derived from visits and explicit edits;
- journal, summaries, revisit prompts, and yearly export;
- generic configuration and onboarding model;
- scrubbed sample dataset and architecture narrative for portfolio use;
- assessment of extracting reusable packages into a separate public project.

The public/general product is not built in v1. We only maintain boundaries that
make later extraction possible.

## Immediate next experiment

After GitHub access and dates are confirmed:

1. initialize the new private repository and typed project foundation;
2. build the new map experience and domain contracts from scratch, consulting
   the legacy prototype only for optional product lessons;
3. implement the evidence manifest and a few smoke fixtures;
4. run a minimal OpenClaw/WeChat proof of concept in an isolated environment;
5. build the agreed 30-item calibration set once connector ingestion works;
6. decide whether OpenClaw passes to Milestone 2 and which source connector gets
   Milestone 4 priority.

## Scope controls

Do not let these block the travel-ready version:

- importing every historical post before the map works;
- automatic reservations or payments;
- public signup or multi-user roles;
- native mobile applications;
- local large-model inference;
- a universal scraper;
- framework-specific memory as the only place personal data lives.
