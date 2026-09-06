# Japan Atlas Product Design v0.3

Status: active product baseline
Last updated: 2026-09-06
Supersedes: `product-design-v0.2.md`

## 1. Product definition

Japan Atlas is Andy's private, long-lived map of restaurants, cafés, events,
exhibitions, and architecture. It is not a generic travel planner and it is not
primarily a data-entry website.

The product has two complementary surfaces:

- **WeChat Agent — primary action surface.** Capture links, creators, text,
  voice, location, photos, and visit notes; ask for nearby recommendations;
  update records; and receive progress or clarification requests.
- **Private map — primary browsing and memory surface.** Explore the collection
  spatially, inspect sources and reservation facts, see personal photos and
  visit history, compare visited/unvisited places, and make occasional
  corrections.

Both surfaces call the same product operations and use the same durable data.
The map must never become a second, conflicting database.

## 2. Interaction boundary

### Agent-first actions

- queue a creator/profile/post for collection;
- add a visit from text, voice, location, or images;
- attach and caption photos;
- set or update the one persistent personal rating for a place;
- ask for nearby, unvisited, open, or reservation-compatible places;
- edit place text and personal metadata;
- receive import progress and resolve short clarification questions.

### Map-first actions

- browse and search the trusted collection;
- view map markers and selected-place details;
- see source links, dated ratings, booking information, event dates, and
  freshness;
- see one consolidated personal record per place;
- browse each visit and its photos without duplicating the place;
- filter visited/unvisited, saved/planned, type, area, tag, and time-sensitive
  status;
- make a correction or upload from the web as a fallback, not as the primary
  daily workflow.

### Transitional navigation

The current standalone Inbox and Journal screens remain temporarily accessible
until the WeChat write path reaches feature parity. They should not define the
final information architecture. The target map uses contextual panels:

- a selected-place **My record** panel for rating, visits, and photos;
- a review deep link from WeChat for ambiguous identity evidence;
- no permanent Inbox or Journal top-level destination once those replacement
  paths are reliable.

This avoids removing the only working write interface before the Agent exists.

## 3. Journal and personal memory model

The current model incorrectly stores a rating on every journal entry. The
replacement separates the place-level assessment from repeatable visits.

### `PlaceAssessment` — one per Atlas item

- `itemId` — unique relation to the place/event/building;
- `overallRating` — optional, nullable, any finite number from 0–5 when present;
- `summary` — optional long-term opinion;
- `collectionState` — candidate, saved, planned, or archived;
- `updatedAt`.

There is only one current personal rating per item. A later rating edit replaces
that value while the audit log records the change. A museum visit may have no
rating at all; `null` means “not rated”, while `0` is a valid explicit rating.
Direct numeric entry accepts any value from 0–5. A future slider or quick-rating
control may use 0.5 increments without restricting manual entry.

### `Visit` — many per Atlas item

- `id`, `itemId`, `visitedAt`, and optional note;
- chronological visit number derived from visits for the same item;
- optional structured companions or context later;
- created/updated timestamps.

“Visited” is derived from the existence of at least one visit. The UI displays
“1st visit / 2nd visit / 3rd visit” but does not ask the user to maintain that
counter manually. A visit must carry at least one memory payload: rating, note,
or photo. Therefore a rating-only visit is valid; an entirely empty visit is
not. Before media upload exists, the web/API fallback requires rating or note.

### `MediaAsset` and `VisitMedia`

- image bytes live in R2-compatible object storage;
- D1 stores object key, MIME type, dimensions, hash, upload state, timestamps,
  and ownership relations;
- each image has an optional one-line caption such as the dish, room, façade, or
  exhibition section shown;
- media may attach to a visit and therefore also resolves to its Atlas item;
- display order is explicit and images are deduplicated by content hash when
  possible.

The Agent and web fallback use the same upload lifecycle: create upload intent,
store bytes, finalize metadata, attach/caption, then show on the map detail.

## 4. Map presentation

Selecting a marker or result opens one consolidated place record:

1. Japanese-first name, type, address, tags, and visited/unvisited marker;
2. official/Tabelog/Google/reservation information with checked dates;
3. one persistent personal rating, or “Not rated”;
4. visit count, last-visited date, and chronological visit timeline;
5. a photo strip grouped by visit, each image with its caption;
6. personal summary and source-backed place description.

Repeat visits extend the timeline; they never create duplicate place cards or
compete for the same fixed-height panel. Lists use natural content height or a
stable scroll region rather than distributing height across every entry.

Marker styling and filters distinguish:

- unvisited candidates;
- visited places;
- planned/saved places;
- time-sensitive events and reservation releases.

Recommendation defaults should prefer unvisited places unless Andy explicitly
asks for favourites, revisits, or all results.

## 5. Search and discovery

Search has two layers:

### Deterministic web search

Runs locally over normalized Japanese, Chinese, and English text and supports:

- partial and typo-tolerant title matching;
- alternate names, area, address, and description;
- visible tags and aliases;
- tokenized multi-word queries;
- visited/unvisited and other structured filters.

Tag search does not require an LLM. Tags should be visible on result and detail
cards so the search promise is inspectable.

### Agent semantic search

The Agent translates requests such as “附近没去过、可以 walk in、安静一点的
咖啡店” into structured filters, semantic intent, and ranking. It may explain
why a result matches, but it cannot invent tags or factual constraints. Source
and freshness rules still apply.

## 6. Agent operation contract v2

Required operations:

- `search_atlas` and `recommend_places` with visited-state and distance filters;
- `get_item_details` and `get_visit_history`;
- `create_visit` with optional note and no required rating;
- `set_personal_rating` as a place-level upsert;
- `attach_visit_media` and `caption_media`;
- `update_atlas_item` and `update_tags`;
- `queue_creator_import`, `get_import_status`, and review-candidate operations.

Every write requires an idempotency key, typed validation, an audit event, and a
human-readable receipt. A channel adapter such as OpenClaw maps messages to
these operations but never writes D1 or object storage directly.

## 7. Data and trust rules

1. No unlabeled demo data in the production collection.
2. Exact place/branch identity must be supported by evidence or remain in
   review.
3. Japanese is the default title; Japanese, Chinese, and English source text is
   preserved without forced translation.
4. External ratings and Andy's optional personal rating remain separate.
5. Reservation and event facts retain source and checked time; “earliest
   bookable” is computed only from a published rule or a live calendar.
6. Journal images and notes are private product data and are never used as
   public portfolio fixtures.
7. Deleting a visit or image must be recoverable where practical and must not
   delete its canonical place.

## 8. Current status

The project is in the **experimental stage**. The durable map and API are real,
but the primary Agent/WeChat workflow, collector worker, media storage, and the
replacement journal model are not complete. The current Inbox and Journal are
transitional scaffolding, not the final product navigation.
