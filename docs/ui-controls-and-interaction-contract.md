# UI Controls and Interaction Contract v0.1

Status: active implementation contract
Last updated: 2026-09-06

This document prevents visual experiments from silently diverging from the
database or Agent behavior. Layout branches may move or restyle controls, but
they must preserve these meanings, confirmations, and shared operations.

## 1. Shared control contract

| Control | User-visible result | Durable operation | Confirmation | Agent parity |
|---|---|---|---|---|
| `喜欢 / 已喜欢` | Toggle favourite state | `PATCH /api/items/{id}/personal` with `isFavorite` | Immediate receipt; undo by toggling | `update_item_preferences` |
| `没去过 / 去过` | Toggle explicit visited state | Same endpoint with `hasVisited` | Immediate receipt; visits still imply visited | `update_item_preferences` |
| Edit | Change title, description, collection state | `PATCH /api/items/{id}` | Save/cancel form | `update_atlas_item` |
| Delete row action | Remove place and attached private records | `DELETE /api/items/{id}`; create bootstrap tombstone | Mandatory named confirmation dialog | `delete_atlas_item`, destructive |
| Type filter | Show food, event, architecture, or all | View-model state only | None | Structured search filter later |
| Personal filter | Show all, unvisited, visited, or favourite | View-model state only | None | Recommendation/search filter later |
| Search | Match normalized name, alternate name, area, address, description, and tags | Deterministic view-model query | None | `search_atlas` in Agent v2 |
| Map marker | Select and focus one place | View-model selection | None | `focus_atlas_item` |
| Near me | Request location and distance-sort results | Browser geolocation; no stored location | Browser permission | `find_nearby_atlas_items` |
| Save visit | Add dated visit; note and rating optional | `POST /api/journal`; optional rating updates the one place assessment | Save receipt | `create_visit` |
| Personal rating | Set any 0–5 value or clear it | `PATCH /api/items/{id}/personal` | Show persisted value | `set_personal_rating` |

## 2. Rating semantics

- `null` means not rated; `0` is a valid explicit score.
- Manual numeric entry accepts any finite value from 0 through 5.
- A future slider, stars, or quick picker may step by 0.5.
- Rating belongs to the place assessment, never to an individual visit.
- Tabelog/Google ratings remain separate source snapshots with checked dates.

## 3. Visit and media semantics

- A visit requires a place and date; note and personal rating are optional.
- Visit numbering is derived chronologically and never typed by the user.
- One place has one persistent rating and any number of visits.
- In v1, every uploaded image may have one optional one-line caption.
- A visit may contain photos while its note and rating are both empty.
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

## 6. Known incomplete controls

| Control | Current state | Completion dependency |
|---|---|---|
| Photo upload and per-image caption | Not implemented | R2 binding, media tables, upload/finalize APIs |
| Review ambiguous identity | Transitional Inbox only | Collector evidence model and review candidate API |
| Agent semantic search/recommendation | Deterministic web filters only | Agent v2 application service |
| Map place/geocoder search | Collection search exists; external geocoder absent | Provider/privacy decision and rate-limit policy |
