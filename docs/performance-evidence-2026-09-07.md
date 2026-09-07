# Performance Evidence — 2026-09-07

Status: implementation verified locally; hosted measurements pending deployment

## Issue #1 — map pan and zoom

### Before

- Leaflet forced `updateWhenIdle: true` and `updateWhenZooming: false`, batching
  tile work after interaction instead of using the progressive desktop defaults.
- `keepBuffer` was 4.
- every item/filter change cleared the complete marker layer and rebuilt it.
- `ResizeObserver` invalidated the map immediately for every resize callback.

### After

- removed the two scheduling overrides and restored Leaflet's progressive
  defaults;
- returned `keepBuffer` to 2 and restored normal marker zoom behavior;
- isolated React from Leaflet through `AtlasMapAdapter` and injected tile
  provider configuration;
- reconciled markers by stable ID/signature instead of clearing the layer;
- coalesced resize invalidation to one animation frame and debounced move-end.

Local proof: marker-plan unit tests verify stable collision offsets and that an
unchanged marker is neither removed nor rebuilt. Type-check, lint, production
build, and the complete unit suite pass. Hosted frame/tile timings are still
required before the issue is closed.

## Issue #2 — Journal save latency

### Before

One create request executed about 13 D1 statements across five serial waiting
phases. It resolved the item by reading five complete datasets, inserted the
Visit, repeated all five reads, read the assessment, and finally upserted it.
The two writes were not atomic.

### After

- one targeted item resolver replaces all mutation-time full-table reads;
- one D1 `batch()` atomically performs the idempotent Visit insert and targeted
  assessment upsert;
- a client mutation UUID is both the optimistic and durable Visit ID;
- a retry uses `ON CONFLICT(id) DO NOTHING` and cannot duplicate the Visit;
- pending Journal work no longer disables unrelated map/place controls.

Structural budget for create: **2 D1 binding round trips, 3 statements, 0
full-table reads**, down from about 13 statements and five serial waiting phases.
SQLite contract tests verify idempotency and preservation of unrelated favorite
and summary fields. Hosted p50/p95 remains to be sampled after deployment.

## Acceptance budget

| Metric | Budget |
|---|---:|
| Interaction or main-thread long task | no event above 200 ms |
| Frame gap | p95 < 50 ms; max < 100 ms |
| Tile settle with fixed 100 ms fixture delay | p95 < 400 ms |
| Journal optimistic paint | p95 <= 100 ms |
| Journal D1 binding round trips | 2 |
| Retry duplicates / partial Visit writes | 0 |

Map tests must use fixture/intercepted tiles rather than automated load against
the public OSM tile service. Run hosted smoke checks in both the Codex in-app
browser and standalone Chrome to separate an embedded-browser compositor issue
from application or tile-network latency.
