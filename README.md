# Japan Personal Atlas

A self-hosted restaurant map for saving places, recording visits and media, and finding saved restaurants nearby. Visitors can read published places, personal ratings and comments, visits, photos and videos without logging in. Only the owner can add or change data or run Recommend and other Agent operations that may incur provider usage. Each deployment uses its own database, storage, model credentials, and optional map credentials.

The application owns the Agent workflow. You provide an OpenAI-compatible model endpoint; the backend uses its built-in web search tool to research a restaurant, validate structured information, and save it after confirmation. Search defaults to a no-key provider. A model API key authenticates model calls; the application supplies the separate search tool.

Version 0.1.0 is restaurant-focused. Add researches sourced profiles, presents an editable preview and saves after Owner confirmation. Missing facts remain unknown; the Owner can complete location information and refresh the preview. Recommend uses the saved collection. Source availability varies, and the current restaurant collection is in Japan; broader international, architecture and event intake validation is planned for the next version.

## Who can use it?

| Role | Access |
| --- | --- |
| Visitor to an existing deployment | Browse published places, personal ratings/comments, Visits, photos and videos without logging in. |
| Owner of a deployment | Add/edit records, configure the deployment's model key, use Recommend and explicitly load Google ratings. |
| Person cloning this repository | Deploy a separate copy in their own Cloudflare account, choose their own Owner password and provide their own API keys. Their database, media and credentials are independent. |

There is one Owner identity and one model configuration per deployment. There is no registration, per-user collection or bring-your-own-key visitor account on someone else's instance. Anyone given an instance's Owner password has the same full Owner access and uses that instance's provider configuration. For your own collection and billing, create your own deployment; cloning the repository does not copy another deployment's Cloudflare resources, secrets or personal records.

First-time setup order: prepare credentials → create Cloudflare resources → configure owner secrets → deploy → log in → test and save model settings → use Add. Model settings may alternatively be configured as deployment secrets. Local development is optional and described after deployment and usage instructions.

## Requirements

- Node.js 22.13 or newer and npm.
- A Cloudflare account with Workers, D1, and R2 enabled. Workers runs the app; D1 stores records; R2 stores photos and videos.
- An OpenAI-compatible chat-completions endpoint, model name, and API key for automated extraction.
- No separate search key is required. Japanese/Tabelog queries use Yahoo Japan public search; other queries use DuckDuckGo HTML search. Optionally provide a Tavily API key instead.
- Optionally, Google Cloud credentials for Places API (New), Geocoding API, and Routes API. Without these services, Google matching and verified route calculations are unavailable.

Provider usage can incur charges. Set quotas and budget alerts in your accounts. Credentials belong on the server.

## Cloudflare setup

Clone or fork the repository, then run:

```sh
git clone https://github.com/AndyZhou952/jp-food-event-map.git
cd jp-food-event-map
cd apps/web
npm ci
cp wrangler.owner-poc.jsonc wrangler.owner-poc.local.jsonc
npx wrangler login
npx wrangler d1 create japan-atlas-owner-poc
npx wrangler r2 bucket create japan-atlas-owner-poc-media
```

Edit `wrangler.owner-poc.local.jsonc`: replace the placeholder `database_id` with the ID returned by D1 creation. Keep the `DB` and `MEDIA` binding names. The existing `owner-poc` resource names are created in your own account; they do not refer to someone else's deployment.

**Choose the optional services before your first deploy.** The template includes Google matching and a private route Worker binding, so copying it without adjusting those settings is not a complete minimal setup:

- **Without Google:** set `vars.CATALOG_INTAKE_GOOGLE_PLACES_MODE` to `"disabled"` and remove the `services` entry for `ROUTE_SIDECAR`. Keep `CATALOG_INTAKE_DURABLE_GEOCODER_MODE` enabled for the bounded address lookup. Japanese Add can use Tabelog discovery; Google scores, Google matching and verified walking routes are unavailable.
- **With Google:** keep matching enabled, set your own `GOOGLE_PLACES_API_KEY`, and either deploy the route Worker as described below or remove its binding until ready.
- The `browser` binding is optional with the default Firecrawl reader. Remove it if you do not want Cloudflare Browser Run enabled.

Keep the supplied Worker/resource names, environment guards, migration directory and observability settings for the supported setup. The preflight checks those names within your account. The ignored local configuration is preferred automatically when building; never replace it with another person's database ID.

Apply the schema:

```sh
npx wrangler d1 migrations apply japan-atlas-owner-poc --remote --config wrangler.owner-poc.local.jsonc
```

Before upgrading an existing deployment, export its database:

```sh
npx wrangler d1 export japan-atlas-owner-poc --remote --config wrangler.owner-poc.local.jsonc --output atlas-backup.sql
```

Keep exports private and outside Git. A fresh database starts with five demonstration places, not the existing Owner's collection, Visits, media or credentials. Review the demonstration catalog before entering personal data.

### Owner and model settings

Set secrets through the interactive prompts:

```sh
npx wrangler secret put ATLAS_OWNER_PASSWORD --config wrangler.owner-poc.local.jsonc
npx wrangler secret put ATLAS_OWNER_SESSION_SECRET --config wrangler.owner-poc.local.jsonc
```

Choose your owner password and independently generate a random session secret, for example using `openssl rand -hex 32` (at least 32 characters). The password is configured here as a server secret; there is no registration page. After deployment, Owner login checks this password. To change it later, repeat the password secret command. Never use a `NEXT_PUBLIC_` variable for secrets.

For a new account, Wrangler may ask to create the named Worker when setting its first secret. Confirm creation in your own account. These are the only secrets required for the minimal first deployment; you can add your model key through Owner settings afterward.

| Credential | Where to configure it | Required for |
| --- | --- | --- |
| `ATLAS_OWNER_PASSWORD` | Main Worker secret | Owner login. |
| `ATLAS_OWNER_SESSION_SECRET` | Main Worker secret | Signed sessions and default credential encryption; use an independent random value. |
| Model API key, base URL and model | Owner → Agent API settings, or deployment settings below | Add research and Recommend; ordinary browsing and Visit recording do not require model calls. |
| `GOOGLE_PLACES_API_KEY` | Main Worker secret | Optional Google matching/ratings; required if Google matching mode is enabled. |
| `GOOGLE_MAPS_API_KEY` | Private route Worker secret | Optional origin geocoding and verified walking routes; do not put it on the main Worker. |
| `SEARCH_API_KEY` | Main Worker secret | Optional Tavily search instead of the no-key providers. |
| `FIRECRAWL_API_KEY` | Main Worker secret | Optional authenticated listing-reader quota. |
| `AGENT_SETTINGS_SECRET` | Main Worker secret, before saving settings | Optional independent encryption key. |

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

### Restaurant page reader

Search finds a restaurant's page; a separate reader retrieves the actual listing and aggregate score. The checked-in PoC configuration selects `"RESTAURANT_SOURCE_READER": "firecrawl"` in `vars`. This calls Firecrawl from the Worker; the website, model workflow, database and photos remain on Cloudflare. Only the public Tabelog listing URL is sent to this reader, not owner cookies or model credentials.

[Firecrawl currently documents initial calls without a key](https://docs.firecrawl.dev/introduction). That anonymous path worked in the deployed PoC, but it is not an unlimited-free or long-term reliability guarantee. If you need higher limits, obtain your own account/key and set this optional server secret before deployment:

```sh
npx wrangler secret put FIRECRAWL_API_KEY --config wrangler.owner-poc.local.jsonc
```

The reader requests fresh HTML and checks the exact branch URL, source status and restaurant aggregate rating. Service quota errors and challenge pages are reported as unavailable evidence, never invented scores. Check your reader account's limits and pricing before enabling paid usage. A DeepSeek/OpenAI key cannot be used as a Firecrawl key.

Alternatively, remove `RESTAURANT_SOURCE_READER` to use ordinary reads with the optional Cloudflare Browser Run binding (`"browser": { "binding": "BROWSER" }`) as a fallback. This path was unreliable for Tabelog in the tested deployment. It requires no browser-service token or extra server, but counts toward Cloudflare's [Browser Run allowance and charges](https://developers.cloudflare.com/browser-run/pricing/). Remove the browser binding too if you only want ordinary HTTP reads. A successful browser API response does not prove the source page loaded.

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

For address resolution and explicit walking routes, deploy the private route Worker with a key allowed to call Geocoding API and Routes API:

```sh
npx wrangler secret put GOOGLE_MAPS_API_KEY --config wrangler.route-sidecar.jsonc
npx wrangler deploy --config wrangler.route-sidecar.jsonc
```

Keep the app's `ROUTE_SIDECAR` binding pointed at `japan-atlas-route-sidecar`. If omitting route services, remove that entry from the app's `services` array to avoid referencing a missing Worker. Recommend uses straight-line distance by default and must report unavailable route information rather than invent travel times when a walking route is explicitly requested. The route Worker has no public website endpoint.

## Verify and deploy

From `apps/web`:

```sh
npm run lint
npm run typecheck
npm run test:evals
mkdir -p .wrangler
npx wrangler secret list --config wrangler.owner-poc.local.jsonc --format json > .wrangler/owner-poc-secret-names.json
npm run deploy:owner-poc
```

The ignored `.wrangler/owner-poc-secret-names.json` contains secret names, not values, and is required by deployment preflight. Refresh it after changing Worker secrets. Open your own URL printed by Wrangler, rather than the original Owner's website. Log in with the password you configured and use Agent API settings to test/save your own model key if not already configured. Add one restaurant, confirm, refresh, and check that it remains visible. Test a personal rating and a photo separately. An unavailable source must remain unknown.

### Your deployment URL

After the first deploy, add `"ATLAS_PUBLIC_URL": "https://your-worker.your-subdomain.workers.dev"` to the local configuration's `vars`, using the URL Wrangler printed or your configured custom domain. This identifies your deployment for address lookup; it is public configuration, not a secret. To generate social-preview URLs for your site, set `NEXT_PUBLIC_SITE_URL` to the same URL when building, for example:

```sh
NEXT_PUBLIC_SITE_URL=https://your-worker.your-subdomain.workers.dev npm run deploy:owner-poc
```

Replace the example URL with yours. Without these settings, branding is generic, address lookup identifies the public repository, and deployment-specific social images are omitted. Existing installations keep their own local settings when pulling code updates.

### Common first-setup problems

| Symptom | Check |
| --- | --- |
| Preflight rejects the database ID | Replace the template placeholder with the D1 ID created in your account. |
| A required Google secret is missing | Supply your Places key, or disable Google matching in the local configuration. |
| Deployment references a missing route Worker | Deploy the private route Worker, or remove its `services` binding. |
| Owner login fails | Use your configured Owner password; verify both Owner secrets are set. |
| Agent research is unavailable | In Owner settings, test/save a model endpoint and key with tool-call support. |
| Research finds a place but facts are unknown | Check the source-reader/search availability; correct supported fields and refresh the preview rather than assuming the model key provides web access. |
| Photos or video uploads fail | Verify your R2 bucket, `MEDIA` binding, supported format and file-size limit. |

After an update to an existing deployment, run `ALLOW_PRODUCTION_MEDIA_AUDIT=yes npm run audit:media-integrity` from `apps/web` to compare each Visit media row with its R2 object's byte count and SHA-256 without saving media locally. The audit is read-only and requires the Wrangler login and ignored local configuration used for deployment.

For updates, apply new migrations, rebuild, and deploy. Preserve D1 and R2 resources. Do not overwrite newer records with an older backup during rollback.

## Using the website

Start here only after completing configuration and deployment above. Visitors can read published restaurants, personal ratings and comments, visits, photos and videos without logging in. Adding or changing data and running Recommend require the owner password.

1. Open the deployed URL, select **Owner login**, and enter the password you configured as `ATLAS_OWNER_PASSWORD`.
   If the model was not configured during deployment, open **Owner active → Agent API settings**, enter your key/model/base URL, and select **Test & save**.
2. Open **Add place** in the top-right workspace, enter a restaurant name or short hint, and select **Find matches**. For a chain or an ambiguous name, keep the name and fill **Area, station or branch (optional)**, then select **Find matches** again. Choose the intended candidate; multiple matches are never preselected. Research shows a waiting indicator while checking sources. If location research is incomplete, edit the original preview fields directly to enter a verified address; add coordinates only if address lookup still fails. Select **Update preview** before confirming. Researched values are prefilled, and unchanged sourced facts are not converted into owner assertions. Ratings, reservation rules and other unsupported facts may remain unknown.
3. Review the proposed name, address, ratings, and reservation information. Confirm, then check that the place appears in the list and map. A preview is not a saved record. Unknown fields mean the sources did not establish those facts.
4. Use the heart to mark a favorite and the visited control to mark a place as visited. For a dated record, use **Add a visit** in the restaurant card or **Journal**. A date is enough; notes, photos, videos and a rating are optional. MP4 and WebM videos can be up to 50 MB each. **Overall マイスコア** updates your overall restaurant score, not a historical per-visit score, and remains separate from external ratings. After saving, the form is ready for another visit. If a media upload fails, add the missing files to the saved visit rather than creating it again. Open media to edit its caption; press Enter or leave the caption field to save. **Edit** on the restaurant header edits restaurant metadata; the pencil beside a Visit edits that dated record, including its restaurant. Changing a Visit's restaurant moves its note and media without changing either restaurant's overall score. The Journal sort menu orders all visits across restaurants by visit date or entry time, oldest or newest first.
5. Open **Ask Recommend** in the same top-right workspace to find a saved restaurant from a place, area, cuisine, or travel preference. An area-only request can return saved restaurants in that area. Without a travel mode, nearby ranking uses straight-line distance and labels travel time unverified. A timed walking request needs a specific origin and a verified route. Switching Add/Recommend or closing the workspace preserves each draft. Places contains catalog search, filters and the saved list.
6. Open **Table** to browse ratings, overview, reservation information, sources and expandable Visit notes/media. Sort by name, last Visit, personal score, Tabelog or Google score; unknown values remain last in both directions. Combine specific cuisine filters with country and first administrative subdivision filters. These classifications are stored separately from the original card tags. Japan prefectures, mainland China provincial divisions and US states are supported; unsupported or uncertain subdivisions remain unknown. The owner can also inspect historical unpublished candidates here; public visitors see published records only.

Google scores fetched by the Owner are shared between Map and Table for the current page. The Owner can explicitly query Google Maps ratings for the current filtered rows; opening, filtering and sorting never trigger a bulk provider query. Queries may incur Google API usage. The live response disappears on reload/logout. The Owner can save a separate Google rating reference with its source, observation date and save date; this reference is private and survives reloads. Add confirmation saves the initial successfully fetched Google score with the restaurant. Loading newer ratings never overwrites the reference: use **Replace reference** explicitly. A failed lookup preserves the existing reference. Published stored research ratings remain readable by visitors. Unqueried scores and unavailable sources have distinct states.

### Calling Add from an integration

`GET /api/agent/capabilities` describes the existing Add operations and required inputs:

1. `POST /api/catalog-intake/discover`: send `query` and a retry-stable `requestToken`; receive candidates and a session/version.
2. `POST /api/catalog-intake/select`: send the session ID, expected session version and chosen `ordinal`; receive clarification or a preview.
3. `POST /api/catalog-intake/confirm`: only after explicit owner approval, send the session ID and expected preview version. A preview without usable location evidence returns `failed_no_write`; retry research instead of creating a hidden candidate. Handle conflicts rather than silently confirming a changed preview. Historical `committed_needs_review` receipts may still replay, but new incomplete previews cannot create another hidden candidate. Historical candidates are available to the owner through Table, not to anonymous readers or Map/Journal.
4. `POST /api/catalog-intake/cancel`: cancel with the session ID and expected session version.

These website endpoints require the owner session cookie and same-origin checks. Read the `x-atlas-web-conversation-id` response header from discovery and echo it on later requests using the same session. A model API key is not an application login credential. The built-in model proposes research facts; application code validates them, and confirmation authorizes persistence. Do not send inferred facts as owner assertions or write directly to the database.

An external Agent can instead use `POST /api/agent/catalog-intake` with a dedicated `ATLAS_ADD_AGENT_TOKEN` Worker secret. Send `Authorization: Bearer <token>` and JSON `{ "operation": "catalog.intake.discover", "input": { "query": "restaurant name", "requestToken": "stable retry ID" } }`. Then use the same endpoint for `catalog.intake.select`, `catalog.intake.confirm`, or `catalog.intake.cancel`, with the same operation inputs listed above. Echo the returned `x-atlas-agent-conversation-id` header on every call after discovery. This token grants access only to Add; it cannot edit Visits, ratings, media, or saved restaurant metadata. The Agent route rejects `ownerFields`, `tabelog`, and `reservation` assertions in `select`; human corrections belong in the website. An Agent must present the current preview for human review before sending `confirm`; a changed preview requires a new review. Confirmation uses the same validation, version, duplicate and idempotency checks as the website. Configure a random 32–128 character URL-safe token as the Worker secret; without it, the endpoint returns 503. Store the token in a private password manager or ignored local file, never in this repository or a browser page.

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

## Public language

Use English for documentation, pull requests, code comments and interface text. Preserve restaurant names, the established Japanese Map and Journal labels, original user content and multilingual matching or evaluation data. Additional interface languages are deferred. Acceptance and CI checklists are shared in chat only.
