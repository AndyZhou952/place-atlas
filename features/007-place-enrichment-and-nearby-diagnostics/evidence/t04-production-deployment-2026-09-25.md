# T-04 production deployment evidence — 2026-09-25

## Deployment

- Reviewed local commit: `d41a12a`.
- Private Route Sidecar upload/preflight: PASS; deployed version prefix `547fb726`, confirmed at 100% traffic.
- Owner Worker fresh D1 seed evidence and deployment preflight: PASS.
- Owner Worker deployed version prefix `63e982a0` at the existing Owner PoC URL.
- Route Sidecar secret-name allowlist: `GOOGLE_MAPS_API_KEY` only.
- Owner Worker secret-name allowlist: the reviewed seven names; no direct `GOOGLE_MAPS_API_KEY` binding.
- Owner Worker retains exactly one private `ROUTE_SIDECAR` service binding.

No secret value, private query, coordinates, provider body, Owner identifier,
Catalog row, D1/R2 resource identifier, or full Cloudflare deployment identifier
is recorded in this evidence.

## Read-only smoke

| Surface | Result |
|---|---|
| `/` | HTTP 200 |
| `/api/items` | HTTP 200 |
| `/terms` | HTTP 200 |
| `/privacy` | HTTP 200 |
| retired `/api/inbox` | HTTP 404 |
| anonymous same-origin `POST /api/catalog-intake/discover` | HTTP 401 before provider dispatch |
| missing-origin write probe | HTTP 403 before provider dispatch |

The private Sidecar public-route preflight passed before and after upload.

## Awaiting Owner acceptance

T-04 remains open until the Owner demonstrates:

1. Web Add: choose a candidate without retyping, review, and confirm once.
2. WeChat Add: `/jpmap add ... → select 1 → confirm` without the removed repeat-input prompt.
3. Web Nearby: `池袋` reaches Geocoding and Routes and returns the pre-verified saved Ikebukuro place.

The local production React/CSS browser gate already passed with eleven desktop
and 390 px scenarios; those artifacts live under `evidence/ui/t02-browser/`.
