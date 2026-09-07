# UI Controls and Interaction Contract v0.1

Status: active implementation contract
Last updated: 2026-09-07

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
| Save visit | Add dated visit; rating, note, or photo must provide content | `POST /api/journal`; optional rating updates the one place assessment | Save receipt | `create_visit` |
| `マイスコア` | Show beside the source rating in detail and list; double-click detail value to edit or clear | `PATCH /api/items/{id}/personal` | Optimistic update and rollback | `set_personal_rating` |

## 2. Rating semantics

- `null` means not rated; `0` is a valid explicit score.
- The current Journal and inline editor default to 3 and step by 0.5.
- The domain/API still validates the inclusive 0–5 range independently of UI.
- Rating belongs to the place assessment, never to an individual visit.
- Personal and Tabelog/Google ratings are displayed together for comparison,
  but remain separate values in storage.
- Individual cards do not repeat source check times. The selected-place detail
  shows one consolidated latest check time at the bottom.

## 3. Visit and media semantics

- A visit requires a place and date plus at least one of rating, note, or photo.
- A rating-only visit is valid even when it has no photo and an empty note.
- Visit numbering is derived chronologically and never typed by the user.
- One place has one persistent rating and any number of visits.
- In v1, every uploaded image may have one optional one-line caption.
- A visit may contain photos while its note and rating are both empty, but an
  entirely content-free visit is invalid.
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
- Personal-state changes must not rebuild map markers.
- Marker selection changes marker state in place and recenters without a long
  animated flight.
- Full-canvas CSS filters and backdrop blur must not cover the moving tile
  surface.
- The current OSM raster provider is a functional baseline, not a promise of
  Google Maps-level vector rendering. Provider evaluation remains a separate
  production decision tracked in GitHub issue #1. Hosted Journal request
  profiling is tracked in issue #2.

## 7. Known incomplete controls

| Control | Current state | Completion dependency |
|---|---|---|
| Photo upload and per-image caption | Not implemented | R2 binding, media tables, upload/finalize APIs |
| Review ambiguous identity | Transitional Inbox only | Collector evidence model and review candidate API |
| Agent semantic search/recommendation | Deterministic web filters only | Agent v2 application service |
| Map place/geocoder search | Collection search exists; external geocoder absent | Provider/privacy decision and rate-limit policy |
