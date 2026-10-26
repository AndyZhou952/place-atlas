# Japan Atlas (place-atlas)

A self-hosted map and journal of the restaurants you care about in Japan. Run it on your own Cloudflare account; your records, photos and keys stay there.

- **Map, Table and Journal**: browse saved restaurants with Tabelog scores, your own 0–10 ratings, hours, closing days and reservation rules; filter by cuisine and prefecture.
- **Add**: type a restaurant name; the match is verified on Google Maps (or found on Tabelog), a research agent gathers the Tabelog score, hours, reservation rules and official links, and you review and edit the preview before anything is saved. Missing facts stay unknown.
- **Journal**: record visits with notes, photos and videos.
- **Recommend**: ask in your own words ("新宿駅の近くでラーメン"); suggestions come only from your saved restaurants, with a follow-up question when the starting point is unclear.

Visitors can browse; only the Owner (one password per deployment) can change anything. See [architecture](docs/architecture.md) and [status](docs/status.md).

## Deploy your own

You need Node.js 22.13+ and a Cloudflare account with Workers, D1 and R2.

```sh
git clone https://github.com/AndyZhou952/place-atlas.git
cd place-atlas/apps/web
npm ci
cp wrangler.jsonc wrangler.local.jsonc
npx wrangler login
npx wrangler d1 create place-atlas            # copy the printed database_id into wrangler.local.jsonc
npx wrangler r2 bucket create place-atlas-media
npx wrangler d1 migrations apply DB --remote --config wrangler.local.jsonc
npx wrangler secret put ATLAS_OWNER_PASSWORD --config wrangler.local.jsonc
npx wrangler secret put ATLAS_OWNER_SESSION_SECRET --config wrangler.local.jsonc   # e.g. `openssl rand -hex 32`
npm run deploy
```

Open the printed URL, choose **Owner login**, then open **Model settings** to save an OpenAI-compatible key (DeepSeek or OpenAI). The model powers the Add research agent and interprets Recommend requests. Without it, Add still finds and locates the place and you complete the details yourself; Recommend reports that it is unavailable.

### Optional settings

Set secrets with `npx wrangler secret put NAME --config wrangler.local.jsonc` and plain values under `vars` in `wrangler.local.jsonc`.

| Name | Purpose |
| --- | --- |
| `GOOGLE_PLACES_API_KEY` + `CATALOG_INTAKE_GOOGLE_PLACES_MODE=enabled` | Add verifies the typed name against Google Maps, and the Owner can load Google ratings. Without it, Add searches Tabelog. Monthly request caps are enforced in D1. |
| `CATALOG_INTAKE_DURABLE_GEOCODER_MODE=enabled` | Confirms Add coordinates with OpenStreetMap Nominatim (on by default; results are cached for 30 days). |
| `FIRECRAWL_API_KEY` | Your own quota for reading Tabelog through Firecrawl (`RESTAURANT_SOURCE_READER=firecrawl`, the default). Tabelog often refuses requests from Cloudflare directly. |
| `SEARCH_API_KEY` | Tavily web search for the research agent (otherwise public search pages are used). |
| `AGENT_API_KEY`, `AGENT_BASE_URL`, `AGENT_MODEL` | Server-managed model instead of the Owner settings form. |
| `AGENT_SETTINGS_SECRET` | Separate 32+ character key for encrypting saved model keys (defaults to the session secret). |
| `ATLAS_ADD_AGENT_TOKEN` | 32–128 character URL-safe Bearer token for the external Add Agent API (`GET /api/agent/capabilities` describes it). |
| `ATLAS_PUBLIC_URL` | Your site URL, sent as contact information to Nominatim. |
| `ROUTE_SIDECAR` service binding | Recommend from a station or address: geocoding, straight-line distance and walking times through the separate route sidecar Worker (below). Without it, food and area requests still work, but a station or address cannot be resolved. |

#### Route sidecar (optional)

The route sidecar is a separate, private Worker that holds a Google Maps key for geocoding and walking matrices:

```sh
npx wrangler secret put GOOGLE_MAPS_API_KEY --config wrangler.route-sidecar.jsonc
npm run deploy:route-sidecar
```

Then add `"services": [{ "binding": "ROUTE_SIDECAR", "service": "japan-atlas-route-sidecar" }]` to `wrangler.local.jsonc` and deploy again.

### Upgrading from 0.1

No data migration is needed: 0.2 reads the same D1 tables and both stored record formats, keeps existing sessions and saved model keys valid, and serves the same photo links. Back up first:

```sh
npx wrangler d1 export DB --remote --config wrangler.owner-poc.local.jsonc --output atlas-backup.sql
```

Your existing `wrangler.owner-poc.local.jsonc` keeps working (it is picked up automatically; renaming it to `wrangler.local.jsonc` is optional). Its old `main` entry is replaced at build time; its variables, secrets, daily cleanup cron and route sidecar binding are used as before. The Add and Recommend endpoints (`/api/catalog-intake/*`, `/api/agent/catalog-intake`, `/api/recommend`) keep their request and response formats. Event and architecture records are no longer shown but stay in the database. The in-browser (WebMCP) agent tools were removed; external agents use the Add Agent API.

## Develop

```sh
cd apps/web
printf 'ATLAS_OWNER_PASSWORD=dev\nATLAS_OWNER_SESSION_SECRET=%s\n' "$(openssl rand -hex 32)" > .dev.vars
npx wrangler d1 migrations apply DB --local
npm run dev            # Vite + the Worker on http://localhost:5173
npm test               # unit and wiring tests
npm run benchmark      # Add/Recommend benchmark (see benchmarks/README.md)
npm run lint && npm run typecheck && npm run format:check
```
