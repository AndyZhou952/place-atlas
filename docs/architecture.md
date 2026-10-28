# Architecture

Japan Atlas is one Cloudflare Worker that serves a React single-page app and a JSON API. D1 stores records and Add sessions, R2 stores photos and videos. Each deployment has one Owner; visitors can read everything that is published. An optional second Worker, the route sidecar, holds the Google Maps key used to geocode Recommend starting points and compute walking times.

## Layout (`apps/web`)

```
src/shared/          Types and pure rules used by both sides
  types.ts             Browse/journal API shapes (Restaurant, Visit, Media, …)
  catalog-intake.ts    Add API contract (discover/select/confirm/cancel inputs and outputs, preview)
  catalog-intake-preview.ts, catalog-intake-warnings.ts, restaurant-profile.ts
                       Preview presentation, warning order, profile/overview rules
  recommend-conversation.ts
                       Recommend API contract (query + clarification replies → recommend/clarify)
  cuisine.ts, hours.ts, text.ts, result.ts
src/server/          The Worker
  worker.ts            Route table: HTTP → handlers, plus the daily cleanup cron
  auth.ts              Owner login, HMAC session cookie, Add conversation ids, Add Agent token
  db.ts, record.ts     D1/R2 repository; stored payload ⇄ Restaurant for both stored formats
  settings.ts          Encrypted model settings and the tool-call connection check
  agent/               The agent harness (below)
src/client/          The browser app (MVVM)
  api.ts               Model: the only module that talks HTTP
  viewmodels/          State and actions as hooks (useAtlas, useAdd + add-state, useRecommend, …)
  views/               React components; OwnerWorkspace holds the Add and Recommend panels
route-sidecar/       Separate Worker: Google geocoding and walking matrix (contract, Google calls, entrypoint)
```

Dependencies point one way: `views → viewmodels → api → (HTTP) → worker → agent/db → shared`. Shared code imports nothing from the server or the browser.

## Agent harness (`src/server/agent`)

| Area | Files | Role |
| --- | --- | --- |
| Add wiring | `add/compose.ts`, `add/http.ts`, `add/google-rating.ts` | Builds the harness from deployment settings; HTTP contract, conversation checks and error codes; Google rating for a preview |
| Add workflow | `add/workflow.ts`, `add/validate.ts` | The session state machine (discover → select → Owner edits → confirm, or cancel) with versions and compare-and-swap, 30-minute expiry, one initial research run, confirm-time re-checks and duplicate detection; validation of every input, provider result and model claim |
| Add storage | `add/store.ts`, `add/stored-item.ts`, `add/saved-place-duplicates.ts` | Sessions in D1 (one active per conversation) and the one-shot publisher: item, identity, receipt and catalog revision in one conditional batch; a retry replays the receipt |
| Discovery | `discovery/google-places.ts`, `discovery/tabelog-search.ts` | Google Places text search (Japan only) verifies the typed name when enabled; otherwise Tabelog listings found by search; a pasted Tabelog URL is read directly |
| Location | `discovery/nominatim.ts` | Nominatim coordinates with a shared rate gate and 30-day cache in D1 |
| Quotas | `discovery/quota.ts` | Monthly per-SKU request and cost caps in D1; bounded provider responses |
| Research agent | `research/agent.ts`, `research/instructions.ts`, `research/branch-match.ts` | Reads the listing, official site and booking page, then a tool-calling loop (at most two searches in all, three model turns, 35 s). When the first search finds no listing for the selected branch, the second retries its name and area. Only facts quoted from a source about the selected branch are kept, and a reservation mode must be the dine-in rule its quote states. Refused or empty searches are reported to the Owner as such |
| Research readers | `research/tabelog-listing.ts`, `research/page-reader.ts`, `research/web-search.ts`, `research/official-site.ts`, `research/booking.ts` | Tabelog listing parsing, Firecrawl/browser/direct reads (a listing is read once per request), search, official pages, TableCheck/Toreta pages and booking windows |
| Recommend | `recommend/compose.ts`, `recommend/service.ts`, `recommend/interpreter.ts`, `recommend/intent.ts`, `recommend/food.ts`, `recommend/decision.ts`, `recommend/receipt.ts`, `recommend/geo-distance.ts` | The model only interprets the request; deterministic rules normalize it, choose candidates from the saved catalog and write the reasons |
| Routes | `recommend/routes.ts`, `route-sidecar/*` | Metered calls to the route sidecar for geocoding and walking times |

## Data

`atlas_items.payload_json` holds each restaurant. Records published by Add keep their sourced facts under `intakeEvidence`; older records use a flat shape. `record.ts` projects both. Personal data lives beside it: `place_assessments` (rating 0–10, favorite, visited, comment), `visits`, `visit_media` (R2 object key plus an opaque public `pm_…` id). Add uses `catalog_intake_sessions`, terminal session references, publish receipts and the Nominatim cache; the cron removes expired sessions and stale cache rows daily.

Deleting a restaurant removes its visits, media objects, assessment and references and leaves a tombstone. Migrations in `migrations/owner-poc` are append-only; tables that are no longer written (request tokens, research allowances, per-item evidence snapshots) stay for existing databases, and the cleanup cron still ages out their old rows.

## Add

1. **Discover** (`POST /api/catalog-intake/discover {input:{query, requestToken}}`): with Google Places enabled, the typed name is matched on Google Maps (up to three candidates with Google attribution); otherwise Tabelog listings are found by search. The response starts a session (replacing the conversation's earlier one) and returns the conversation header to echo on later steps.
2. **Select** (`select {sessionId, expectedSessionVersion, ordinal, requestResearch}`): the chosen place is re-read from its provider (Google in Japanese, like its Tabelog listing; its map pin only corroborates the listing's identity and is not stored) and geocoded with Nominatim and the research agent gathers the Tabelog score, reservation rule, hours, categories, dishes and official links. Research runs once per session, on the first selection. Every fact needs a source URL and quote from the same branch, or it stays unknown. The Owner can edit fields and select again with the current session version to refresh the preview; Owner edits are sent as explicit assertions.
3. **Confirm** (`confirm {sessionId, expectedPreviewVersion}`): the place identity and geocoded coordinates are checked again and the researched Tabelog and booking pages are re-read (once per preview version). A changed preview is returned for review instead of being saved; a place without a name, address and coordinates is never saved; otherwise the restaurant is published once (a retry returns the same receipt), with the staged Google rating as a dated reference.

The external Add Agent sends `{operation, input}` to `/api/agent/catalog-intake` with `Authorization: Bearer ATLAS_ADD_AGENT_TOKEN` (never with a cookie). `operation` is one of `catalog.intake.discover`, `catalog.intake.select`, `catalog.intake.confirm` or `catalog.intake.cancel`, and the agent may not assert Owner-only fields.

## Recommend

`POST /api/recommend {query, replies, originChoice?}`. The model receives the request, earlier answers and the saved areas and place names, and returns a structured interpretation (food terms, origin, travel mode, visited preference). Code normalizes it against the request text, so the model cannot invent origins, restaurants or routes. Food terms and each saved restaurant's labels reduce to the same keys (`recommend/food.ts`: six dish terms, the cuisine taxonomy and national cuisines such as French), so a cuisine with no saved match returns no results. Candidates come only from saved restaurants. A station or address is geocoded by the route sidecar; distances are straight-line unless the sidecar returned walking times, which are shown with their source and time. Google has no train routes in Japan, so a train time limit gets a fixed answer suggesting walking or no time limit. Unclear starting points and timed routes without a start produce a clarifying question.

## Security

- Writes require the Owner cookie (HMAC-SHA256, 30 days, `HttpOnly; Secure; SameSite=Strict`) and a same-origin `Origin` header. Add, Recommend and Google ratings are Owner-only (or the Add Agent token) because they spend provider quota.
- Model keys are encrypted with AES-GCM (key derived by HKDF from a server secret) and never returned to the browser.
- Outbound requests use fixed endpoints, manual redirects, timeouts, size limits and monthly quotas. Source text is passed to the model as data and every claim is validated against its quote.
- Uploads are limited to JPEG/PNG/WebP/GIF (8 MB) and MP4/WebM (50 MB) and checked by file signature.
