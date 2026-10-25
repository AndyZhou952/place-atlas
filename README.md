# Japan Atlas (place-atlas)

A self-hosted map and journal of the restaurants you care about in Japan. Run it on your own Cloudflare account; your records, photos and keys stay there.

- **Map, Table and Journal**: browse saved restaurants with Tabelog scores, your own 0–10 ratings, hours, closing days and reservation rules; filter by cuisine and prefecture.
- **Add**: search Tabelog by name (or paste a listing URL), review the proposed record, then save. Facts come from the exact listing you choose; missing facts stay empty.
- **Journal**: record visits with notes, photos and videos.
- **Recommend**: ask in your own words ("新宿駅の近くでラーメン") and get picks from your saved restaurants.

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

Open the printed URL, choose **Owner login**, then open **Model settings** to save an OpenAI-compatible key (DeepSeek or OpenAI). The model is optional: without it, Add still saves the listing's facts and Recommend falls back to keyword matching.

### Optional settings

Set secrets with `npx wrangler secret put NAME --config wrangler.local.jsonc` and plain values under `vars` in `wrangler.local.jsonc`.

| Name | Purpose |
| --- | --- |
| `FIRECRAWL_API_KEY` | Your own quota for reading Tabelog through Firecrawl (`RESTAURANT_SOURCE_READER=firecrawl`, the default). Tabelog often refuses requests from Cloudflare directly. |
| `SEARCH_API_KEY` | Tavily search instead of the public Yahoo! JAPAN / DuckDuckGo pages. |
| `GOOGLE_PLACES_API_KEY` | Matches each restaurant to Google Maps and lets the Owner load Google ratings. |
| `AGENT_API_KEY`, `AGENT_BASE_URL`, `AGENT_MODEL` | Server-managed model instead of the Owner settings form. |
| `AGENT_SETTINGS_SECRET` | Separate 32+ character key for encrypting saved model keys (defaults to the session secret). |
| `ATLAS_ADD_AGENT_TOKEN` | 32+ character Bearer token that lets an external agent use the Add API (`GET /api/add` describes it). |
| `ATLAS_PUBLIC_URL` | Your site URL, sent as contact information to the OpenStreetMap geocoder. |

### Upgrading from 0.1

No data migration is needed: 0.2 reads the same D1 tables and both stored record formats, keeps existing sessions and saved model keys valid, and serves the same photo links. Back up first:

```sh
npx wrangler d1 export DB --remote --config wrangler.owner-poc.local.jsonc --output atlas-backup.sql
```

Your existing `wrangler.owner-poc.local.jsonc` keeps working (it is picked up automatically; renaming it to `wrangler.local.jsonc` is optional). Its old `main` entry and daily cron are overridden at build time. Event and architecture records are no longer shown but stay in the database. The route sidecar Worker, browser (WebMCP) tools and the operation-based `/api/agent/catalog-intake` endpoint were removed; external agents use `/api/add/*` with the same token.

## Develop

```sh
cd apps/web
printf 'ATLAS_OWNER_PASSWORD=dev\nATLAS_OWNER_SESSION_SECRET=%s\n' "$(openssl rand -hex 32)" > .dev.vars
npx wrangler d1 migrations apply DB --local
npm run dev            # Vite + the Worker on http://localhost:5173
npm test               # unit tests
npm run benchmark      # Add/Recommend benchmark (see benchmarks/README.md)
npm run lint && npm run typecheck && npm run format:check
```
