# Japan Personal Atlas

A self-hosted restaurant map for saving places, recording visits and photos, and finding saved restaurants nearby. The website is publicly readable; only the owner can change it. Each deployment uses its own database, storage, model credentials, and optional map credentials.

The application owns the Agent workflow. You provide an OpenAI-compatible model endpoint; the backend uses its built-in web search tool to research a restaurant, validate structured information, and save it after confirmation. Search defaults to a no-key provider. A model API key authenticates model calls; the application supplies the separate search tool.

This is an evolving PoC. Map, owner authentication, personal records, and deterministic Add are implemented. Automated research is being integrated and evaluated. Categories, signature dishes, international ratings, and screenshot input are not all guaranteed by the current runtime. Offline benchmark success alone does not demonstrate live provider coverage.

First-time setup order: prepare credentials → create Cloudflare resources → configure owner/model secrets → deploy → log in and use the website. Local development is optional and described after the deployment and usage instructions.

## Requirements

- Node.js 22.13 or newer and npm.
- A Cloudflare account with Workers, D1, and R2 enabled. Workers runs the app; D1 stores records; R2 stores photos.
- An OpenAI-compatible chat-completions endpoint, model name, and API key for automated extraction.
- No separate search key is required. Optionally provide a Tavily API key to use Tavily instead of the default DuckDuckGo HTML search.
- Optionally, Google Cloud credentials for Places API (New), Geocoding API, and Routes API. Without these services, Google matching and verified route calculations are unavailable.

Provider usage can incur charges. Set quotas and budget alerts in your accounts. Credentials belong on the server.

## Cloudflare setup

Clone this repository, then run:

```sh
cd apps/web
npm ci
cp wrangler.owner-poc.jsonc wrangler.owner-poc.local.jsonc
npx wrangler login
npx wrangler d1 create japan-atlas-owner-poc
npx wrangler r2 bucket create japan-atlas-owner-poc-media
```

Edit `wrangler.owner-poc.local.jsonc`: replace the placeholder `database_id` with the ID returned by D1 creation. Keep the `DB` and `MEDIA` binding names. The existing `owner-poc` resource names are created in your own account; they do not refer to someone else's deployment.

Apply the schema:

```sh
npx wrangler d1 migrations apply japan-atlas-owner-poc --remote --config wrangler.owner-poc.local.jsonc
```

Before upgrading an existing deployment, export its database:

```sh
npx wrangler d1 export japan-atlas-owner-poc --remote --config wrangler.owner-poc.local.jsonc --output atlas-backup.sql
```

Keep exports private and outside Git. Historical migrations may seed demonstration places on an empty database; review the catalog before entering personal data.

### Owner and model settings

Set secrets through the interactive prompts:

```sh
npx wrangler secret put ATLAS_OWNER_PASSWORD --config wrangler.owner-poc.local.jsonc
npx wrangler secret put ATLAS_OWNER_SESSION_SECRET --config wrangler.owner-poc.local.jsonc
npx wrangler secret put AGENT_API_KEY --config wrangler.owner-poc.local.jsonc
```

Choose your owner password and independently generate a random session secret, for example using `openssl rand -hex 32`. The password is configured here as a server secret; there is no first-run password creation or registration page. After deployment, Owner login checks this password. To change it later, repeat the password secret command. `AGENT_API_KEY` is your model key. Never use a `NEXT_PUBLIC_` variable for secrets.

Add these model settings to the local Wrangler configuration's `vars`:

```json
{
  "AGENT_BASE_URL": "https://api.deepseek.com/v1",
  "AGENT_MODEL": "deepseek-flash"
}
```

This is an example endpoint/model pair. Replace both with your provider's documented values. The model must support chat completions with function/tool calls. Enter the API base URL, not a consumer chat website URL. Set all three model settings (`AGENT_API_KEY`, `AGENT_BASE_URL`, and `AGENT_MODEL`) together: incomplete configuration returns research unavailable. Test your chosen combination before relying on automatic enrichment.

Search works without a separate key by requesting DuckDuckGo's HTML results. This is best effort: page changes, rate limits, or a challenge against your deployment's IP can temporarily prevent research. The application does not bypass challenges or turn a failed search into invented facts. Search results supply snippets. For the first discovered Tabelog restaurant listing in each search, the backend also tries a bounded page read and extracts only structured branch identity and aggregate rating, never individual review scores. This is not a general full-page browsing service; official-site reservation reading remains incomplete. A failed source does not discard facts supported by another successful source.

To use Tavily instead, optionally set its key:

```sh
npx wrangler secret put SEARCH_API_KEY --config wrangler.owner-poc.local.jsonc
```

Providing `SEARCH_API_KEY` selects Tavily. Leave it unset for the default no-key search. The search provider is independent of the model provider.

### Optional Google services

For candidate matching, enable Places API (New) and configure:

```sh
npx wrangler secret put GOOGLE_PLACES_API_KEY --config wrangler.owner-poc.local.jsonc
```

Set `CATALOG_INTAKE_GOOGLE_PLACES_MODE` to `enabled` only with working credentials; otherwise set it to `disabled`. Existing records remain readable without Google.

The current Add candidate-discovery step still requires Google Places. No-key web search enriches a selected restaurant; it does not yet replace Google for finding and choosing restaurant identities. Google-free Add discovery remains follow-up work.

For address resolution and walking routes, deploy the private route Worker with a key allowed to call Geocoding API and Routes API:

```sh
npx wrangler secret put GOOGLE_MAPS_API_KEY --config wrangler.route-sidecar.jsonc
npx wrangler deploy --config wrangler.route-sidecar.jsonc
```

Keep the app's `ROUTE_SIDECAR` binding pointed at `japan-atlas-route-sidecar`. If omitting route services, remove that entry from the app's `services` array to avoid referencing a missing Worker. Nearby must report unavailable route information rather than invent travel times. The route Worker has no public website endpoint.

## Verify and deploy

From `apps/web`:

```sh
npm run lint
npm run typecheck
npm run test:evals
npm run build:owner-poc
npx wrangler deploy --config dist/server/wrangler.json
```

Open the URL printed by Wrangler. Log in, add one restaurant, confirm, refresh, and check that the saved record remains visible. Test a personal rating and a photo separately. If research fails, inspect provider configuration and the source error before retrying. An unavailable score must remain unknown.

For updates, apply new migrations, rebuild, and deploy. Preserve D1 and R2 resources. Do not overwrite newer records with an older backup during rollback.

## Using the website

Start here only after completing configuration and deployment above. Visitors can read the site without logging in; changing data requires the owner password.

1. Open the deployed URL, select **Owner login**, and enter the password you configured as `ATLAS_OWNER_PASSWORD`.
2. Open **Add a place**, enter a restaurant name or short hint, and select **Find matches**. If multiple branches fit, choose the intended branch.
3. Review the proposed name, address, ratings, and reservation information. Confirm, then check that the place appears in the list and map. A preview is not a saved record. Unknown fields mean the sources did not establish those facts.
4. Use the heart to mark a favorite and the visited control to mark a visit. Edit and Journal provide personal ratings, notes, visits, and photos. Personal scores are separate from external ratings.
5. Enter a neighborhood or address in Nearby to search your saved places. Straight-line distance is not a verified walking time.

### Calling Add from an integration

`GET /api/agent/capabilities` describes the existing Add operations and required inputs:

1. `POST /api/catalog-intake/discover`: send `query` and a retry-stable `requestToken`; receive candidates and a session/version.
2. `POST /api/catalog-intake/select`: send the session ID, expected session version and chosen `ordinal`; receive clarification or a preview.
3. `POST /api/catalog-intake/confirm`: only after explicit owner approval, send the session ID and expected preview version. Inspect the returned status and item ID; `committed_needs_review` is not a map-ready success. Handle conflicts rather than silently confirming a changed preview.
4. `POST /api/catalog-intake/cancel`: cancel with the session ID and expected session version.

These endpoints require the existing owner session cookie and same-origin checks. Read the `x-atlas-web-conversation-id` response header from discovery and echo it on later requests using the same session. A model API key is not an application login credential. There is no dedicated external-agent bearer-token interface yet. The built-in model proposes research facts; application code validates them, and confirmation authorizes persistence. Do not send inferred facts as owner assertions or write directly to the database.

## Local development (optional)

Create an ignored `apps/web/.dev.vars` file:

```dotenv
ATLAS_OWNER_PASSWORD=your-local-password
ATLAS_OWNER_SESSION_SECRET=your-independent-random-secret
AGENT_API_KEY=your-model-key
# Optional:
SEARCH_API_KEY=your-tavily-key
GOOGLE_PLACES_API_KEY=your-google-places-key
```

Configure the model base URL and name in Wrangler vars as above, then run:

```sh
cd apps/web
npx wrangler d1 migrations apply japan-atlas-owner-poc --local --config wrangler.owner-poc.local.jsonc
npx vinext dev --mode owner-poc
```

Local development does not automatically start a route Worker. Start or bind it separately for route integration tests. Never commit `.dev.vars`, keys, exports, or local account configuration.

## Agent evaluation

Versioned datasets under `apps/web/evals` cover short multilingual hints, romanization, chain ambiguity, no-match cases, wrong-branch evidence, missing facts, and provider failures.

```sh
cd apps/web
npm run test:evals
npm run eval:place-resolution
npm run eval:place-enrichment
```

Example predictions test the scorers. A live quality report must use predictions generated by the configured model and research workflow. Confirmation visibility and duplicate prevention also require integration tests. Preserve sources and observation times; never fabricate ratings or booking advice when sources fail.

For a live research smoke test, set `AGENT_API_KEY`, `AGENT_BASE_URL`, and `AGENT_MODEL` in the process environment. Leave `SEARCH_API_KEY` unset for no-key search, or set it to use Tavily. Run from `apps/web`:

```sh
node --experimental-strip-types agent/live-smoke.mjs "Restaurant name" "Exact branch address"
```

This incurs provider usage and prints structured research output and elapsed time. It does not write a restaurant. It tests the current narrow enrichment stage (Tabelog and explicit reservation facts); it is not an end-to-end Add benchmark or a test of all desired fields.

To evaluate full-profile extraction with your actual model, put `AGENT_API_KEY`, `AGENT_BASE_URL`, and `AGENT_MODEL` in `apps/web/.env` (Git-ignored), then run from `apps/web`. For DeepSeek V4.1 Flash, use the official model ID `deepseek-flash` and set `AGENT_EVAL_REASONING_EFFORT=none` for this bounded extraction baseline. DeepSeek otherwise defaults to thinking mode, which can exhaust this test's token cap before returning JSON. This setting applies only to the evaluation runner; leave it unset for providers that do not support `reasoning_effort`.

```sh
node --experimental-strip-types --env-file=.env evals/run-add-enrichment.mjs evals/runs/add-extraction.json
```

This makes one model request per benchmark case (currently ten), with a 4,500 output-token cap and a 60-second limit per request. It uses supplied, labelled source fixtures rather than live search, and a separate experimental full-profile extraction prompt rather than the current production Add prompt. It tests identity/address/coordinates, categories, summary/dishes, ratings, official/booking links, and reservation rules. Expected answers are withheld from the model. Results include per-field failures, token usage when available, latency, and the production workflow's unsupported fields. Failed cases are retained. Output is private and Git-ignored; choose a new filename for another run. Passing extraction is not full Add acceptance: live retrieval, description review, confirmation, database persistence and map rendering still require separate checks. No restaurant is written by this command.
