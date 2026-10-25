# Architecture

Japan Atlas is one Cloudflare Worker that serves a React single-page app and a JSON API. D1 stores records and Add sessions, R2 stores photos and videos. Each deployment has one Owner; visitors can read everything that is published. An optional second Worker, the route sidecar, holds the Google Maps key used for Recommend routes.

## Layout (`apps/web`)

```
src/shared/          Types and pure rules used by both sides
  types.ts             Browse/journal API shapes (Restaurant, Visit, Media, …)
  catalog-intake.ts    Add API contract (discover/select/confirm/cancel inputs and outputs, preview)
  catalog-intake-preview.ts, catalog-intake-warnings.ts, restaurant-profile.ts
                       Preview presentation, warning order, profile/overview rules
  recommend-conversation.ts
                       Recommend API contract (query + clarification replies → recommend/clarify)
  cuisine.ts, hours.ts, text.ts, research-region.ts, result.ts
src/server/          The Worker
  worker.ts            Route table: HTTP → handlers, plus the daily cleanup cron
  auth.ts              Owner login, HMAC session cookie, Add conversation ids, Add Agent token
  db.ts, record.ts     D1/R2 repository; stored payload ⇄ Restaurant for both 0.1 formats
  settings.ts          Encrypted model settings and the tool-call connection check
  agent/               The agent harness (below)
src/client/          The browser app (MVVM)
  api.ts               Model: the only module that talks HTTP
  viewmodels/          State and actions as hooks (useAtlas, useAdd + add-state, useRecommend, …)
  views/               React components; OwnerWorkspace holds the Add and Recommend panels
route-sidecar/       Separate Worker: Google geocoding, walking matrix and transit routes
```

Dependencies point one way: `views → viewmodels → api → (HTTP) → worker → agent/db → shared`. Shared code imports nothing from the server or the browser.

## Agent harness (`src/server/agent`)

| Area | Files | Role |
| --- | --- | --- |
| Add wiring | `add/compose.ts`, `add/http.ts`, `add/google-rating.ts` | Builds the harness from deployment settings; HTTP contract, conversation checks and error codes; Google rating for a preview |
| Add workflow | `add/coordinator.ts` | Session state machine: discover → select (research) → owner edits → confirm, with versions, expiry, research allowances, validation of every model claim and duplicate detection |
| Add storage | `add/d1-session-state.ts`, `add/d1-publisher.ts`, `add/stored-item.ts`, `add/saved-place-duplicates.ts` | Add sessions in D1; atomic publication of the confirmed restaurant (with `intakeEvidence`) and receipts |
| Discovery | `discovery/tabelog-place-discovery.ts`, `discovery/google-place-discovery.ts`, `discovery/google-places-client.ts` | Google Places text search verifies the typed name when enabled; otherwise Tabelog listings found by search; a pasted Tabelog URL is read directly |
| Location | `discovery/nominatim-geocoder.ts`, `discovery/nominatim-transport.ts`, `discovery/nominatim-policy-state.ts` | Nominatim coordinates with a shared rate gate and 30-day cache in D1 |
| Quotas | `discovery/provider-usage.ts`, `discovery/bounded-json-http.ts` | Monthly per-SKU request and cost caps in D1; bounded provider responses |
| Research agent | `research/place-research.ts`, `research/research-instructions.ts` | Tool-calling loop (at most two `search_web` calls, three model turns, 35 s) that returns sourced facts with exact quotes; the coordinator rejects unsupported claims |
| Research readers | `research/tabelog-listing.ts`, `research/web-search.ts`, `research/firecrawl-source-reader.ts`, `research/tabelog-source-fallback.ts`, `research/browser-source-reader.ts`, `research/official-site-reader.ts`, `research/tablecheck-booking.ts`, `research/toreta-booking.ts`, `research/reservation-timing.ts` | Tabelog listing parsing, search, official site and booking-page readers, booking-window extraction |
| Recommend | `recommend/compose.ts`, `recommend/conversation-service.ts`, `recommend/interpreter.ts`, `recommend/intent.ts`, `recommend/decision.ts`, `recommend/receipt.ts`, `recommend/search-policy.ts`, `recommend/geo-distance.ts` | The model only interprets the request; deterministic rules normalize it, choose candidates from the saved catalog and write the reasons |
| Routes | `recommend/route-sidecar-client.ts`, `recommend/route-sidecar-adapter.ts`, `recommend/route-ports.ts`, `route-sidecar/*` | Metered calls to the route sidecar for geocoding, walking and transit evidence |

## Data

`atlas_items.payload_json` holds each restaurant. Records published by Add keep their sourced facts under `intakeEvidence`; older records use a flat shape. `record.ts` projects both. Personal data lives beside it: `place_assessments` (rating 0–10, favorite, visited, comment), `visits`, `visit_media` (R2 object key plus an opaque public `pm_…` id). Add uses `catalog_intake_sessions`, research allowances, receipts and the Nominatim cache; the cron removes expired sessions and stale cache rows daily.

Deleting a restaurant removes its visits, media objects, assessment and references and leaves a tombstone. Migrations in `migrations/owner-poc` are append-only; tables that are no longer read stay for existing databases.

## Add

1. **Discover** (`POST /api/catalog-intake/discover {input:{query, requestToken}}`): with Google Places enabled, the typed name is matched on Google Maps (up to three candidates with Google attribution); otherwise Tabelog listings are found by search. The response starts a session and returns the conversation header to echo on later steps.
2. **Select** (`select {sessionId, expectedSessionVersion, ordinal, requestResearch}`): the chosen place is geocoded with Nominatim and the research agent gathers the Tabelog score, reservation rule, hours, categories, dishes and official links. Every fact needs a source URL and quote from the same branch, or it stays unknown. The Owner can edit fields and select again to refresh the preview; Owner edits are sent as explicit assertions.
3. **Confirm** (`confirm {sessionId, expectedPreviewVersion}`): evidence is checked again. A changed preview is returned for review instead of being saved; otherwise the restaurant is published once (a retry returns the same receipt), with the staged Google rating as a dated reference.

The external Add Agent sends `{operation, input}` to `/api/agent/catalog-intake` with `Authorization: Bearer ATLAS_ADD_AGENT_TOKEN` (never with a cookie) and may not assert Owner-only fields.

## Recommend

`POST /api/recommend {query, replies}`. The model receives the request, earlier answers and the saved areas and place names, and returns a structured interpretation (food terms, origin, travel mode, visited preference). Code normalizes it against the request text, so the model cannot invent origins, restaurants or routes. Candidates come only from saved restaurants. A station or address is geocoded by the route sidecar; distances are straight-line unless the sidecar returned walking or transit evidence, which is shown with its source and time. Unclear starting points and timed routes without a start produce a clarifying question.

## Security

- Writes require the Owner cookie (HMAC-SHA256, 30 days, `HttpOnly; Secure; SameSite=Strict`) and a same-origin `Origin` header. Add, Recommend and Google ratings are Owner-only (or the Add Agent token) because they spend provider quota.
- Model keys are encrypted with AES-GCM (key derived by HKDF from a server secret) and never returned to the browser.
- Outbound requests use fixed endpoints, manual redirects, timeouts, size limits and monthly quotas. Source text is passed to the model as data and every claim is validated against its quote.
- Uploads are limited to JPEG/PNG/WebP/GIF (8 MB) and MP4/WebM (50 MB) and checked by file signature.
