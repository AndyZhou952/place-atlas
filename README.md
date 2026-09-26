# Japan Personal Atlas

A self-hosted restaurant map for saving places, recording visits and photos, and finding saved restaurants nearby. The website is publicly readable; only the owner can change it. Each deployment uses its own database, storage, model credentials, and optional map credentials.

The application owns the Agent workflow. You provide an OpenAI-compatible model endpoint; the backend uses its built-in web search tool to research a restaurant, validate structured information, and save it after confirmation. Search defaults to a no-key provider. A model API key authenticates model calls; the application supplies the separate search tool.

This is an evolving PoC. Add now researches sourced restaurant profiles, presents a preview, and saves after owner confirmation. Categories, signature dishes, descriptions, ratings and official links flow to the saved card when sources supply them. Missing information stays unknown. Live source coverage varies; screenshots and Agent-led Nearby remain follow-up work. Offline benchmark success alone does not demonstrate live provider coverage.

Current acceptance limit: the Cloudflare PoC can connect to DeepSeek and search for a branch, but Tabelog page reads returned HTTP 403 in live testing. Automatic Add-to-map acceptance has **not passed**. A model key alone does not guarantee source access; a preview without usable coordinates cannot be saved from the website. See the current delivery checklist in `docs/status.md` for verified versus pending work.

First-time setup order: prepare credentials → create Cloudflare resources → configure owner secrets → deploy → log in → test and save model settings → use Add. Model settings may alternatively be configured as deployment secrets. Local development is optional and described after deployment and usage instructions.

## Requirements

- Node.js 22.13 or newer and npm.
- A Cloudflare account with Workers, D1, and R2 enabled. Workers runs the app; D1 stores records; R2 stores photos.
- An OpenAI-compatible chat-completions endpoint, model name, and API key for automated extraction.
- No separate search key is required. Japanese/Tabelog queries use Yahoo Japan public search; other queries use DuckDuckGo HTML search. Optionally provide a Tavily API key instead.
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
```

Choose your owner password and independently generate a random session secret, for example using `openssl rand -hex 32` (at least 32 characters). The password is configured here as a server secret; there is no registration page. After deployment, Owner login checks this password. To change it later, repeat the password secret command. Never use a `NEXT_PUBLIC_` variable for secrets.

Recommended: after deployment, log in and open **Owner active → Agent API settings**. Enter your model API key, base URL and model, then choose **Test & save**. DeepSeek defaults are `https://api.deepseek.com` and `deepseek-flash`; `https://api.openai.com/v1` is also allowed, but individual OpenAI models are not all tested. The server first checks tool-call support, then encrypts the settings in D1. Keys are never returned to the browser or saved in browser storage. Only the owner can view configuration status or change settings. Leave the key blank to keep it when the endpoint is unchanged; changing providers requires a new key.

For this PoC, the web form allows only these official endpoints. GLM, native Claude Messages API and arbitrary proxy endpoints are not yet supported by the form. Server-managed OpenAI-compatible endpoints remain configurable below; operators are responsible for trusting that endpoint. Do not claim compatibility without testing tool calls.

Stored credentials use `AGENT_SETTINGS_SECRET`, or the owner session secret if no dedicated encryption secret is set. For independent key rotation, configure `AGENT_SETTINGS_SECRET` with a random 32+ character value **before** saving settings. Changing that secret makes previously encrypted settings unreadable; re-enter credentials afterward. **Use deployment settings** removes the saved override and restores server configuration (which may be empty).

Alternatively, configure the model entirely at deployment time:

```sh
npx wrangler secret put AGENT_API_KEY --config wrangler.owner-poc.local.jsonc
```

Add these model settings to the local Wrangler configuration's `vars`:

```json
{
  "AGENT_BASE_URL": "https://api.deepseek.com/v1",
  "AGENT_MODEL": "deepseek-flash"
}
```

This is an example endpoint/model pair. Replace both with your provider's documented values. The model must support chat completions with function/tool calls. Enter the API base URL, not a consumer chat website URL. Set all three model settings (`AGENT_API_KEY`, `AGENT_BASE_URL`, and `AGENT_MODEL`) together: incomplete configuration returns research unavailable. Test your chosen combination before relying on automatic enrichment.

Search works without a separate key using Yahoo Japan for Japanese/Tabelog queries and DuckDuckGo for other queries. This is best effort: page changes, rate limits, or a challenge against your deployment's IP can temporarily prevent research. The application does not bypass challenges or invent facts. It reads discovered Tabelog main listings for branch identity, address, coordinates, cuisine, aggregate rating, explicit reservation rules, restaurant introductions and official website links. Individual review scores are excluded. The model extracts sourced dishes; the application builds a concise description from validated categories, area and dishes. Official-source search is supported, but arbitrary full-page official-site browsing is not; missing booking lead times remain unknown. A failed source does not discard independently supported facts.

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

Without Google matching configuration, Add uses no-key search plus verified Tabelog listing identities for Japanese restaurants. Pasting a full Tabelog main-listing URL skips search. This fallback is not worldwide discovery and may fail when a provider blocks requests. Google improves international matching but does not itself guarantee complete or persistable restaurant research.

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
   If the model was not configured during deployment, open **Owner active → Agent API settings**, enter your key/model/base URL, and select **Test & save**.
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

This incurs provider usage and prints structured research output and elapsed time. It does not write a restaurant. It tests production research including sourced profile fields; it is not an end-to-end confirmation, persistence or browser test.

To evaluate full-profile extraction with your actual model, put `AGENT_API_KEY`, `AGENT_BASE_URL`, and `AGENT_MODEL` in `apps/web/.env` (Git-ignored), then run from `apps/web`. For DeepSeek V4.1 Flash, use `deepseek-flash` and set `AGENT_EVAL_REASONING_EFFORT=none` for this bounded extraction baseline. Production research also explicitly disables thinking for the official DeepSeek endpoint to leave its token budget for tool calls and structured results. Leave the evaluation setting unset for providers that do not support `reasoning_effort`.

```sh
node --experimental-strip-types --env-file=.env evals/run-add-enrichment.mjs evals/runs/add-extraction.json
```

This makes one model request per benchmark case (currently ten), with a 4,500 output-token cap and a 60-second limit per request. It uses supplied, labelled source fixtures rather than live search, and a separate experimental full-profile extraction prompt rather than the current production Add prompt. It tests identity/address/coordinates, categories, summary/dishes, ratings, official/booking links, and reservation rules. Expected answers are withheld from the model. Results include per-field failures, token usage when available, latency, and the production workflow's unsupported fields. Failed cases are retained. Output is private and Git-ignored; choose a new filename for another run. Passing extraction is not full Add acceptance: live retrieval, description review, confirmation, database persistence and map rendering still require separate checks. No restaurant is written by this command.
