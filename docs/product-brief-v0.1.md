# Japan Personal Atlas — Product Brief v0.1

Status: discussion draft
Owner and sole user: Andy Zhou
Date: 2026-09-05

Companion documents: [architecture](architecture.md),
[data ingestion and identity resolution](data-ingestion-and-identity-resolution.md),
[evaluation plan](evaluation-plan.md), [roadmap](roadmap.md), and
[decision log](decision-log.md).

## 1. Product definition

### One-sentence positioning

A private, map-based memory and decision assistant that turns Andy's saved food, event, and architecture discoveries into useful recommendations before and during a Japan stay, then preserves the resulting photos and personal reviews as a long-term record.

### The real job to be done

This is not another public restaurant directory. It should close a personal loop:

1. Capture discoveries from social and review platforms with very little effort.
2. Convert messy posts, screenshots, links, and voice notes into structured places and events.
3. Recommend a small number of relevant options based on current location, time, taste, availability, and reservation constraints.
4. Help Andy act at the right time, especially when reservations open or events expire.
5. Record what actually happened and improve future recommendations from Andy's own reviews.

### Product principles

- **Personal truth over crowd consensus.** Public ratings are context; Andy's own notes and trusted sources matter more.
- **Capture first, organize later.** Sending a link or image should create an inbox item even when extraction is incomplete.
- **Three useful choices beat twenty search results.** Recommendations should be concise and explain why each option fits now.
- **Every fact keeps its source and freshness.** Opening hours, event dates, and booking rules change.
- **The agent assists actions but does not silently commit them.** Bookings, payments, cancellations, or messages require explicit confirmation.
- **The product survives a model or chat-channel change.** The map and data layer are the durable core; WeChat and the agent runtime are adapters.

## 2. Primary surfaces

### A. WeChat: daily command and capture surface

WeChat is the fastest surface for:

- sending a Xiaohongshu, X, Bilibili, Tabelog, official-site, or map link;
- sending a screenshot, photo, location, or voice/text note;
- asking for nearby food, events, or architecture;
- receiving reservation-window and event-deadline reminders;
- logging a visit with photos and a short review.

The bot should ask at most one follow-up question for a normal capture. If details are unclear, it should save the item to an inbox rather than block the user.

Example interactions:

> Save this. Maybe ramen in Osaka.
> [link]

> I'm near Kiyosumi-Shirakawa. Give me three saved cafés within a 20-minute walk that are open now and do not need a reservation.

> I just ate here. 8/10, excellent broth, noodles slightly too soft. About ¥1,500.
> [three photos]

Note that the photos in WeChat are sent as separate messages, and the agent should be able to interpret that gracefully.

### B. Mobile web app / PWA: browse, edit, and remember

The web app is the visual source of truth. It should open cleanly inside WeChat and in a normal mobile browser.

Core views:

- **Map:** food, events, and architecture as layers; current location; list/map synchronization.
- **Inbox:** captured items that need confirmation or enrichment.
- **Saved:** searchable and filterable collection.
- **Place detail:** source links, booking rules, notes, visit history, photos, and personal score.
- **Event detail:** date range, venue, ticket/booking deadline, source freshness, and status.
- **Journal:** chronological visit log and personal food record.

### C. Lightweight admin mode

Because there is only one user, a separate admin product is unnecessary. Editing, merge-duplicate, source verification, and bulk import can live behind an `Edit` mode in the same web app.

## 3. Information model

### Place

- identity: canonical name, Japanese name, aliases;
- type: restaurant, café, bar, shop, architecture, museum, venue, other;
- geography: address, latitude/longitude, station/area, map links;
- food metadata: cuisine, price range, signature dishes, dietary notes, google review score / tabelog score (if in Japan);
- personal state: inbox, saved, planned, visited, skipped, archived;
- tags and collections;
- source confidence and last verification time.

### Event

- title, category, venue/place relationship;
- start/end time and timezone;
- ticket or reservation deadline;
- recurrence, cancellation status, and source freshness;
- personal state and notes.

### Source

Every imported claim should retain:

- original URL and platform;
- author/account when available;
- captured text or compact excerpt;
- screenshot/media references when permitted;
- captured time;
- extraction method;
- confidence and verification status.

### Reservation policy

- mode: walk-in, same-day, phone, web, lottery, invite/member, unknown;
- booking URL and phone;
- minimum/maximum lead time;
- release rule, such as “60 days ahead at 10:00 JST” or “first day of the prior month”;
- deposit, prepayment, cancellation, party-size, language, and card requirements;
- source URL and `verified_at` timestamp;
- confidence: confirmed, inferred, or unknown.

### Visit and review

- visit date/time, party size, spend, ordered dishes;
- overall score plus optional food/service/atmosphere/value dimensions;
- free-form review and reusable taste tags;
- photos and optional original voice note;
- “would return” and “would recommend to” notes.

## 4. Recommendation behavior

The assistant should filter deterministically first, then use the model to rank and explain.

Hard filters:

- distance or travel-time radius (via means of travel, walking / public transportation);
- open/event-active at the requested time;
- reservation feasibility;
- budget, category, and explicit exclusions;
- item state, for example saved but not yet visited.

Ranking signals:

- Andy's explicit tags and prior reviews;
- source trust and number of independent sources;
- freshness of hours and reservation data;
- novelty versus repeat preference;
- fit with current context, weather, time available, and group size;
- confidence penalty for missing or stale facts.

Each answer should return approximately three choices with distance, current feasibility, one-sentence rationale, important caveat, and an `Open map` action.

## 5. Ingestion strategy

### Level 1 — Share-to-inbox (MVP and default)

Andy forwards a URL, screenshot, text, or image to WeChat. The system extracts candidate places/events, geocodes them, de-duplicates them, and saves them with source provenance. This is the lowest-friction and most reliable ongoing workflow.

### Level 2 — Official APIs where they provide real value

- X supports reading the authenticated user's bookmarks through OAuth. It is a viable structured import path, but requires an X developer app and usage credits.
- Map/geocoding and official event feeds can be integrated where licensing allows persistent storage.
- The product should not copy third-party reviews wholesale. It stores Andy's source reference and a compact personal summary.

### Level 3 — Browser-assisted import

For logged-in collections that have no suitable official API, a browser skill can inspect the collection in small batches and export source links and candidate entities. This is a user-triggered maintenance tool, not a continuous scraper.

The `eze-is/web-access` skill is suitable as an optional browser operator because it supports logged-in Chrome/Edge sessions and Xiaohongshu-specific patterns. It also explicitly warns that automated social-platform activity can trigger rate limits or account bans. Therefore:

- use a secondary account when practical;
- run it in a dedicated Chrome profile instead of Andy's normal daily-browsing profile;
- start the local proxy only for import sessions and stop it afterward;
- keep batch sizes and frequency low;
- do not automate likes, follows, comments, or posting for this product;
- never make browser automation the only path to a saved item;
- keep raw imports in an inbox until reviewed.

Security note: the audited proxy binds to `127.0.0.1`, which avoids exposing it directly to the network, but its local HTTP endpoints are not authenticated and include arbitrary page JavaScript execution. Any process running as the same local user could potentially control the connected browser while the proxy is active. A dedicated profile and short-lived import sessions are therefore part of the design, not optional polish.

### Source-specific starting position

| Source | Preferred path | Fallback | MVP priority |
|---|---|---|---|
| Xiaohongshu | Send link/screenshot to WeChat | User-triggered browser-assisted collection import | High |
| X | Official bookmarks API | Send link; browser-assisted import | Medium |
| Bilibili | Send link/share card | Browser-assisted favorites import | Medium |
| Tabelog | Send restaurant/list URL | Browser-assisted list import | High |
| Official restaurant/event site | Direct page extraction | Screenshot/manual note | High |
| Instagram/other social | Send link/screenshot | Browser-assisted import if needed | Low initially |

## 6. Recommended architecture

### Durable product core

- **Web client:** Next.js PWA with MapLibre GL JS.
- **Database:** PostgreSQL with PostGIS, initially through Supabase.
- **Media:** Supabase Storage initially; move to object storage later only if needed.
- **Domain API:** scoped endpoints/tools for capture, nearby search, place/event CRUD, reviews, photos, and reminders.
- **Authentication:** one-user allowlist and private access; no public signup.

PostGIS is a good fit because nearby-distance and map-bounds queries are native and indexed. MapLibre provides the map interaction without locking the product data to Google Places licensing rules. External place providers can still be used for discovery and identity resolution, with their data-retention rules respected.

### Agent and WeChat layer

- **OpenClaw Gateway:** recommended production channel/runtime layer.
- **Tencent Weixin OpenClaw plugin:** WeChat direct messages and media, with QR login and sender allowlisting.
- **Agent model:** provider adapter, starting with the OpenAI Responses API or Agents SDK.
- **Agent tools:** only the narrowly scoped domain API; no unrestricted shell or arbitrary browser access from WeChat.
- **Browser ingestion worker:** separate, user-triggered workflow using `web-access` or an equivalent browser harness.

Codex and Claude Code are excellent development harnesses, but they should not be the database or the always-on chat gateway. The application remains usable if the implementation harness changes.

### Deployment modes

1. **Local pilot:** OpenClaw on Andy's Mac, web app hosted, database hosted. Cheapest and fastest, but the Mac must remain awake and online.
2. **Travel-ready:** OpenClaw on a small always-on server, with the web app and database hosted. More reliable while traveling and the recommended destination.

## 7. MVP scope

Must have:

- private sign-in;
- map/list view with food, event, and architecture filters;
- capture URL/text/image from WeChat into an inbox;
- structured place/event confirmation and duplicate merging;
- current-location nearby query;
- three-option recommendation response;
- reservation fields, freshness, and source links;
- visit review with multiple photos;
- basic reservation-window/event-deadline reminders;
- export of all personal data and media references.

Explicitly not in the first release:

- unattended bulk scraping of every social account;
- automatic reservation submission or payment;
- public users, social features, or complex roles;
- route optimization for a full trip;
- model fine-tuning;
- native iOS/Android apps;
- attempting to reproduce all Google Maps or Tabelog data.

## 8. Implementation phases and exit criteria

### Phase 0 — Product and feasibility decisions

Deliverables:

- approved product brief and interaction examples;
- old repository audit;
- WeChat/OpenClaw text, image, voice, and location-message proof of concept;
- one Xiaohongshu link, one X bookmark, and one Tabelog link ingestion proof of concept;
- hosting and privacy choice.

Exit: we can send one item in WeChat, see it on a map, ask for it nearby, and attach a review photo.

### Phase 1 — Durable data and map

Deliverables:

- schema, migrations, private auth, storage, map/list/detail/inbox;
- manual import and export;
- source provenance and duplicate resolution.

Exit: the product works without any LLM or social integration.

### Phase 2 — WeChat assistant

Deliverables:

- OpenClaw deployment and WeChat plugin;
- scoped application tools;
- capture, nearby recommendation, and visit logging flows;
- action confirmations and audit log.

Exit: normal daily use can happen from WeChat.

### Phase 3 — Enrichment and imports

Deliverables:

- source adapters;
- X bookmarks OAuth import;
- optional browser-assisted imports;
- official-site verification and freshness jobs;
- confidence and error-review queue.

Exit: imports save meaningful time without creating an unreliable scraper dependency.

### Phase 4 — Trip operations

Deliverables:

- reservation-window calculation and reminders;
- event expiry/cancellation checks;
- trip dates and simple plan/calendar view;
- stale-information prompts before acting.

Exit: important bookings and events are not missed during the trip.

### Phase 5 — Personal memory

Deliverables:

- journal, summaries, taste profile, revisit suggestions, and yearly export;
- recommendation feedback loop based on Andy's actual choices and reviews.

## 9. Safety, privacy, and maintenance

- Allow only Andy's WeChat identity and application account.
- Store provider tokens outside the repository and rotate them independently.
- Separate read tools from write tools; log every write.
- Require confirmation immediately before bookings, cancellations, payments, or messages to restaurants.
- Preserve source URLs and timestamps; mark facts stale instead of pretending certainty.
- Back up the database and media manifest; support JSON/CSV export.
- Pin plugin/runtime versions and test upgrades, especially the external WeChat plugin.
- Treat every social post or webpage as untrusted content; it cannot redefine agent instructions.

## 10. Current environment audit

Observed on 2026-09-05:

- The current project contains the approved design documents and is ready for
  repository/application initialization.
- Node.js `v24.14.1` satisfies the current OpenClaw and `web-access` minimum requirements.
- Codex CLI and Claude Code are installed.
- OpenClaw is not installed.
- GitHub CLI is authenticated as `AndyZhou952`; the existing SSH key is already
  registered with GitHub.
- The private `AndyZhou952/food-map` repository has been read and build-checked.
  Its visual language and pure map utilities are reusable, but its static JSON/
  Git storage architecture is not suitable for this product. See
  [the legacy audit](legacy-food-map-audit.md).
- Chrome is installed and running, but the `web-access` CDP proxy/remote-debugging port is not currently active.

## 11. Confirmed implementation assumptions

1. WeChat direct messages through the Tencent/OpenClaw integration are the v1
   channel target, using Andy's main WeChat account subject to proof-of-concept
   verification of the plugin's actual account model.
2. Local-first development is acceptable only if migration to the cloud is a
   normal deployment/configuration change. Durable data must never live only in
   a local OpenClaw session.
3. The priority is a usable product. Bulk discovery is still required for
   unvisited places Andy may want to visit, but it must not block the working map
   and daily capture loop.
4. Tokyo and nearby areas are the initial geographic focus.
5. Initial batch discovery should use the creator accounts Andy supplied, then
   present a relevance-screening queue.
6. Product behavior is date-independent. Events and changing restaurant/
   reservation facts use rolling search windows, source observation dates, and
   freshness rules. A specific travel date may later help prioritize delivery
   or reminders, but is not part of the core model.

Known planning context from the second discussion round:

- primary city is Tokyo;
- searches for current events and changing venue facts operate on rolling,
  configurable windows rather than a hard-coded trip year;
- initial source seeds include Xiaohongshu accounts `漫游东京_tokyotrip`
  (`101943310`) and `在日本摸鱼的小超人` (`274834935`), plus Bilibili creator
  `Piggy豚豚酱` (`697821`);
- historical creator discovery is desirable, followed by Andy's manual relevance
  screening;
- the personalized v1 should be decoupled enough to support a later generic
  portfolio/open-source extraction, but that public version is out of v1 scope.

## 12. Proposed next proof of concept

Build the smallest vertical slice with 10 sample items:

1. Import a CSV plus one real shared URL.
2. Display items on a private map.
3. Run a nearby query from a supplied location.
4. Return three recommendations in a temporary chat surface.
5. Add a review and two photos.
6. Only after that works, connect the same tools to WeChat through OpenClaw.

This validates the durable product before spending time on the riskiest platform integrations.

## References used for this draft

- OpenClaw overview: https://docs.openclaw.ai/
- OpenClaw WeChat channel: https://docs.openclaw.ai/channels/wechat
- OpenAI developer platform and Agents SDK: https://developers.openai.com/
- OpenAI API quickstart: https://platform.openai.com/docs/quickstart
- `web-access`: https://github.com/eze-is/web-access
- X bookmarks API: https://docs.x.com/x-api/posts/bookmarks/introduction
- X API pricing: https://docs.x.com/x-api/getting-started/pricing
- Supabase PostGIS: https://supabase.com/docs/guides/database/extensions/postgis
- MapLibre geolocation: https://maplibre.org/maplibre-gl-js/docs/API/classes/GeolocateControl/
- Google Places data policies: https://developers.google.com/maps/documentation/places/web-service/policies
