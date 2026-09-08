# UI Controls and Interaction Contract v0.1

Status: active implementation contract
Last updated: 2026-09-08

This document prevents visual experiments from silently diverging from the
database or Agent behavior. Layout branches may move or restyle controls, but
they must preserve these meanings, confirmations, and shared operations.

## 1. Shared control contract

| Control | User-visible result | Durable operation | Confirmation | Agent parity |
|---|---|---|---|---|
| Heart icon | Toggle favourite state from detail or collection row | `PATCH /api/items/{id}/personal` with `isFavorite` | Optimistic local update; rollback and notice on failure | `update_item_preferences` |
| Circle + `行った` | Toggle explicit visited state from detail or collection row; the label stays fixed and the circle changes fill | Same endpoint with `hasVisited` | Optimistic local update; visits still imply visited | `update_item_preferences` |
| Edit | Change title, description, collection state | `PATCH /api/items/{id}` | Save/cancel form | `update_atlas_item` |
| Delete row action | Remove place and attached private records | `DELETE /api/items/{id}`; create bootstrap tombstone | Mandatory named confirmation dialog | `delete_atlas_item`, destructive |
| Type filter | Show food, event, architecture, or all | View-model state only | None | Structured search filter later |
| Visit + favourite filters | Visit state and favourite are independently selectable; combined active filters require both selected states | View-model state only | None | Recommendation/search filter later |
| Collection-row title | Compact rows start with ellipsis; selected, hovered, or keyboard-focused rows expand the full title | View state only | None | None |
| Collection-row ratings | Place `マイ` and Tabelog badges in the right status rail above the personal controls | Read-only projection of the same item model | None | None |
| Search | Match normalized name, alternate name, area, address, description, and tags | Deterministic view-model query | None | `search_atlas` in Agent v2 |
| Map marker | Select and focus one place | View-model selection | None | `focus_atlas_item` |
| Near me | Request location and distance-sort results | Browser geolocation; no stored location | Browser permission | `find_nearby_atlas_items` |
| Save visit | Add a dated visit with optional photos selected in the same form; rating or note must currently provide the Visit content | `POST /api/journal`, followed by bounded `POST /api/media` batches through one ViewModel action; optional rating updates the one place assessment | Immediate Visit receipt; failed photo batches are reported without losing the saved Visit | `create_visit`; the future capture-session operation composes Visit and media use cases |
| Visit photos | Select up to 24 private images in one browser action; the client sends batches of four, with no fixed per-Visit limit. Edit one-line captions, delete an image, and show a folded gallery in Journal/map detail | `GET/POST /api/media`, `PATCH/DELETE /api/media/{id}`, and authenticated `GET /api/media/{id}/content`, all reached through the ViewModel | Delete requires confirmation; optimistic caption/delete rollback on failure | `list_visit_media`, `update_visit_media_caption`, and confirmed `delete_visit_media`; future service Agent uses the same multipart HTTP operation with explicit Visit/capture context |
| Edit visit | Correct date/note and optionally replace or clear the persistent place rating | `PATCH /api/journal/{id}` through the ViewModel | Save/cancel form | `update_visit` |
| Delete visit | Remove one mistaken Visit and reconcile derived visited state | `DELETE /api/journal/{id}` through the ViewModel | Mandatory confirmation dialog | `delete_visit`, destructive |
| Journal filters | Combine one place with an inclusive from/to date range | View-model projection only | Clear-filter control | Structured Journal query later |
| `マイスコア` | Show beside the source rating in detail and list; double-click detail value to edit or clear | `PATCH /api/items/{id}/personal` | Optimistic update and rollback | `set_personal_rating` |

## 2. Rating semantics

- `null` means not rated; `0` is a valid explicit score.
- The current Journal and inline editor default to 3; spinner arrows step by 0.5.
- Typed input accepts any finite value from 0 to 5 and is normalized to the
  nearest one decimal by the UI, HTTP routes, store, and browser-Agent tools.
- The domain/API still validates the inclusive 0–5 range independently of UI.
- Rating belongs to the place assessment, never to an individual visit.
- Personal and Tabelog/Google ratings are displayed together for comparison,
  but remain separate values in storage.
- Individual cards do not repeat source check times. The selected-place detail
  shows one consolidated latest check time at the bottom.

## 3. Visit and media semantics

- A visit requires a place and date plus a rating or note before media can be attached.
- A rating-only visit is valid even when it has no photo and an empty note.
- Visit numbering is derived chronologically and never typed by the user.
- One place has one persistent rating and any number of visits.
- In v1, every uploaded image may have one optional one-line caption.
- The web form can select photos before Save, but the ViewModel persists the
  Visit first and then attaches bounded media batches. Existing Visits keep an
  `Add photos` fallback.
- Four is a transport-level request bound, not a user or Visit limit. One web
  selection accepts 24 photos and larger sets can use another selection.
- Galleries show four photos initially and expand on request.
- Supporting a photo-only Visit as one atomic command is deferred to the Agent
  capture-session slice, where create/upload can provide compensating cleanup.
- Media is not complete until bytes, metadata, attachment, and caption all
  survive refresh and appear in the selected-place map detail.

## 4. Deletion safety

The web UI must name the place and explain that visits and personal status will
also be removed. Cancel is non-destructive. Confirm deletes dynamic rows and
personal data; a tombstone prevents a source-bundled bootstrap item from
returning. Agent deletion is marked destructive and requires channel-level
explicit confirmation before the operation is invoked.

## 5. Layout-branch invariants

The three branches may differ in where the collection, selected-place detail,
and mobile sheet live. They must all:

1. import the same `useAtlasViewModel`;
2. call the same browser API client and server routes;
3. render multiple map markers and allow marker selection;
4. default to a map-dominant view with a collapsible collection;
5. expose favourite, visited, edit, and confirmed delete actions;
6. preserve accessible names, keyboard focus, and small-screen operation;
7. contain no hard-coded demo records or browser-only saved state.

### Implemented comparison branches

| Branch | Presentation | Trade-off to evaluate |
|---|---|---|
| `codex/ui-floating-drawer` | Full map, overlay collection drawer, floating selected-place card | Most map-dominant; overlapping panels can compete on smaller laptops |
| `codex/ui-split-sidebar` | Collection becomes a fixed left column while open; map reflows | Clearest list browsing; leaves less map width while the list is open |
| `codex/ui-bottom-sheet` | Horizontal collection tray rises from the bottom | Fast visual scanning and mobile direction; reduces vertical detail space while open |

All three branch from the same tested persistence/API/view-model commit. Only
presentation code differs in the two alternatives.

The split-sidebar design is selected and is now the default main presentation.
The main build retains the other variants against the same live API and database
for regression comparison:

- B (default): `/` or `/?layout=split`
- A: `/?layout=floating`
- C: `/?layout=bottom`

These query parameters select presentation only; they do not fork state or
persist a user preference.

## 6. Interaction performance contract

- Favourite and visited controls update locally in the same interaction frame,
  then reconcile with the durable API. A failed write restores the previous
  value and surfaces a notice.
- Journal submissions render an optimistic Visit immediately and restore the
  form/data if the API write fails.
- Journal edits exit edit mode immediately; confirmed deletion closes the
  dialog and removes the Visit immediately. A background failure restores the
  data and reopens the relevant interface.
- Journal create uses a client-provided mutation ID and an atomic D1 batch, so
  timeout retries do not duplicate a Visit or leave assessment state half-written.
- Pending Journal writes do not disable unrelated map/place controls.
- Personal-state changes must not rebuild map markers.
- Marker selection changes marker state in place and recenters without a long
  animated flight.
- Full-canvas CSS filters and backdrop blur must not cover the moving tile
  surface.
- Leaflet uses progressive desktop tile scheduling; map provider, React view,
  and marker reconciliation are separated behind an adapter boundary.
- Performance budget: no interaction or main-thread task above 200 ms; frame
  gap p95 below 50 ms and max below 100 ms; fixed-100-ms fixture tile settle
  p95 below 400 ms. Hosted evidence remains required before closing issues.
- The current OSM raster provider is a functional baseline, not a promise of
  Google Maps-level vector rendering. Provider evaluation remains a separate
  production decision tracked in GitHub issue #1. Journal foreground blocking
  is resolved; the roughly two-second Sites background response floor is
  recorded in issue #2.

## 7. Known incomplete controls

| Control | Current state | Completion dependency |
|---|---|---|
| Server-derived image dimensions and orphan cleanup | Upload, private delivery, captions, hashes, rollback, and cascade cleanup are implemented; dimensions and a scheduled R2 orphan sweeper remain | Media hardening job and reconciliation metrics |
| Review ambiguous identity | Transitional Inbox only | Collector evidence model and review candidate API |
| Agent semantic search/recommendation | Deterministic web filters only | Agent v2 application service |
| Map place/geocoder search | Collection search exists; external geocoder absent | Provider/privacy decision and rate-limit policy |
