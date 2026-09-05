# Legacy `food-map` Audit

Status: completed
Audit date: 2026-09-05
Repository: `AndyZhou952/food-map` (private, default branch `main`)
Audited commit: `001c0c8`

## Summary

The old repository is a clean, working static prototype, not a failed product.
Its strongest assets are the visual direction, map/list interaction, compact
place card, sample-data discipline, and build-time geocoding concept. Its static
“Git is the database” architecture cannot support the new inbox, WeChat writes,
source evidence, events, reservation freshness, multiple visits, or background
jobs.

Recommendation: start the new product from a clean foundation in this repository.
Treat the old map only as optional product research. Do not copy its application
structure, JSON schema, dependency tree, or use it as the backend.

## What was verified

- the repository is private and accessible through Andy's restored GitHub CLI;
- it contains one commit and a small Vite/Leaflet application;
- locked dependencies install successfully;
- the production build completes successfully;
- the bundle is small enough for the current prototype;
- `npm audit` currently reports one high and one moderate transitive
  vulnerability (`nanoid` and `postcss`), both with fixes available;
- the shipped records are explicitly marked sample data.

The dependency findings are another reason to port concepts into a newly locked
stack instead of copying the old lockfile.

## Ideas worth remembering, not code to migrate

### Visual/product language

- rice-paper background, ink typography, and vermilion seal identity;
- rating seal markers;
- synchronized map and card-list interaction;
- city/cuisine filter chips;
- clear external Google Maps and directions actions;
- explicit sample-data badges;
- mobile responsive proportions.

### Domain ideas, after remodeling

- multilingual name and local name;
- cuisine, category, price, area, city, country, coordinates, tags, and photos;
- `distanceKm`/Haversine calculation as a tested pure utility;
- storing coordinates rather than geocoding on each page load;
- map-provider independence and outbound route links.

### Engineering lessons

- static demo mode with a replaceable data source;
- no runtime geocoder key embedded in the client;
- escaping untrusted visible text;
- deterministic deployment build.

## Replace or redesign

| Legacy choice | Why it no longer fits | New direction |
|---|---|---|
| One `places.json` file | Cannot safely support concurrent writes, provenance, visits, reminders, or jobs | PostgreSQL/PostGIS with migrations and export |
| Git as the personal database | WeChat capture needs immediate writes and media handling | Domain API is the only write boundary |
| Place contains one rating/visited date | A place can have multiple visits and changing opinions | Separate `place`, `visit`, `review`, and `media` records |
| Notes contain mixed facts/opinions | Public facts need sources and freshness | Separate sourced claims from personal notes |
| Restaurant-only schema | New scope includes events and architecture | Shared location identity plus typed place/event entities |
| Build-time Nominatim script writes JSON | A temporary network failure stops the whole run; no candidate review | Async geocoding job with provider adapter and review state |
| Arbitrary `?data=` URL | CORS-dependent and has no schema validation | Authenticated import plus validated versioned contracts |
| Vanilla DOM templates | Fine for prototype, harder for growing edit/inbox flows | Typed component UI with MVVM-inspired view models |
| GitHub Pages only | No server jobs, auth, private media, or WeChat webhook/gateway | PWA plus separately deployed API/workers |

## Specific hardening observations

- The code correctly escapes most visible strings, but an untrusted
  `links.site` value is inserted into an `href` without allowlisting `https:` or
  `http:`. The new URL value object must validate schemes.
- Incoming JSON has no runtime schema validation. The new API and importers must
  validate all connector output before it reaches domain logic.
- Straight-line distance is useful for filtering, but must remain explicitly
  distinguished from walking/transit time.
- Public OSM/Nominatim services have usage policies and are not an unlimited
  production backend; keep both behind provider interfaces.

## New-build plan

1. Preserve the old repository unchanged as a historical prototype.
2. Build the new information architecture, types, UI, and adapters independently.
3. Reimplement any generally useful behavior, such as distance calculation,
   behind typed and tested new contracts rather than copying source files.
4. Do not import the legacy sample dataset into the new production database.
5. Consult the old UI only if a past interaction helps answer a specific product
   question; it is not a visual or technical baseline.

## Decision

No direct repository merge and no code migration. The old project is a light
reference only; the new repository is a from-scratch durable product.
