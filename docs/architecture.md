# Architecture

Japan Atlas is one Cloudflare Worker that serves a React single-page app and a JSON API. D1 stores records, R2 stores photos and videos. Each deployment has one Owner; visitors can read everything that is published.

## Layout (`apps/web/src`)

```
shared/        Types and pure domain rules used by both sides
  types.ts       API data shapes (Restaurant, Visit, Media, AddDraft, …)
  cuisine.ts     Cuisine taxonomy, prefectures, overview text
  hours.ts       Tabelog opening-hours formatting
  text.ts        Search normalization, distance, rating and URL rules
server/        The Worker
  worker.ts      Route table: HTTP → handlers (the only place that knows about requests)
  auth.ts        Owner password login, HMAC session cookie, same-origin writes, Add API token
  db.ts          D1/R2 repository: restaurants, assessments, visits, media, Google references
  record.ts      Stored payload ⇄ Restaurant; reads both 0.1 record formats
  settings.ts    Encrypted model settings
  sources/       External readers: web search, Tabelog listing, Google Places, geocoder
  agent/         Model-assisted workflows: llm.ts (one JSON chat call), add.ts, recommend.ts
client/        The browser app (MVVM)
  api.ts         Model: typed calls to the API
  viewmodels/    State and actions as hooks (useAtlas, useAdd, useOwner, …) and pure selectors
  views/         React components that render view-model state and call its actions
```

Dependencies point one way: `views → viewmodels → api → (HTTP) → worker → agent/sources/db → shared`. Views never fetch; the Worker's agent code never touches HTTP requests or D1 directly.

## Data

`atlas_items.payload_json` holds each restaurant. New records use a flat shape that the 0.1 code can also read; 0.1 Add records keep their facts under `intakeEvidence`, which `record.ts` projects. Personal data lives beside it: `place_assessments` (rating 0–10, favorite, visited, comment), `visits`, `visit_media` (R2 object key plus an opaque public `pm_…` id). Title/description edits fold any 0.1 override into the payload. Cuisine and prefecture are derived on read from the stored category labels and address.

Deleting a restaurant removes its visits, media objects, assessment and references and leaves a tombstone. Migrations in `migrations/owner-poc` are append-only; several 0.1 tables are no longer read but remain for existing databases.

## Add

1. **Search**: `"<name> <area> site:tabelog.com"` through Tavily (if configured) or Yahoo! JAPAN, then DuckDuckGo. Up to three main-listing URLs are read; a pasted listing URL skips search. With a Google key and no Tabelog result, Google Places text search supplies candidates.
2. **Preview**: the chosen listing is read again (Firecrawl first when configured, then directly; the final page must be the same listing). Name, aliases, address, coordinates, aggregate score, cuisine labels, reservation row, booking link, official site and hours come from the listing's Restaurant JSON-LD and its own info rows; reviews are never read. A Google place is attached only if it lies within 150 m. The model receives the listing introduction and reservation text and returns signature dishes and a booking note; each must appear verbatim in that text or it is dropped. The Chinese overview is composed by code.
3. **Save**: the Owner edits the draft and saves. The server validates every field (location must be in Japan), rejects a second record for the same Tabelog listing or Google place, and inserts with the draft's id so a retry cannot duplicate.

External agents use the same three endpoints (`/api/add/search|preview|save`) with `Authorization: Bearer ATLAS_ADD_AGENT_TOKEN`; a human should review the draft before saving.

## Recommend

One model call receives the request and a one-line summary of each saved restaurant and returns up to five ids with reasons plus an optional starting point. Ids not in the catalog are discarded and names always come from the database. A starting point is geocoded with OpenStreetMap Nominatim and picks are sorted by straight-line distance, shown in km with a Google Maps walking-directions link (never as walking time). Without a model, keyword matching is used.

## Security

- Writes require the Owner cookie (HMAC-SHA256, 30 days, `HttpOnly; Secure; SameSite=Strict`) and a same-origin `Origin` header. Recommend and Google ratings are Owner-only because they spend provider quota.
- Model keys are encrypted with AES-GCM (key derived by HKDF from a server secret) and never returned to the browser.
- Outbound requests use fixed endpoints, manual redirects, timeouts and size limits. Source text is passed to the model as data and its output is validated.
- Uploads are limited to JPEG/PNG/WebP/GIF (8 MB) and MP4/WebM (50 MB) and checked by file signature.
