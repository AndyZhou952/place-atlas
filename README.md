# Place Atlas

Your own map, restaurant collection and visit journal. Self-host on Cloudflare, keep your data and credentials in your account, and use an AI assistant to research restaurants and recommend places from your collection.

- **Explore:** Map and Table views, search, filters, restaurant details, architecture and events.
- **Collect:** Review sourced restaurant facts before saving; missing facts remain unknown.
- **Remember:** Visits, notes, personal ratings, photos and videos.
- **Recommend:** Find saved restaurants by preferences and location, with optional walking routes.

One Owner manages each deployment; visitors can browse its published records and media. There is no shared-instance registration. Automated research currently focuses on restaurants, with the strongest source support in Japan. Framework and chat integrations are planned. See [development status](docs/status.md) and [architecture](docs/architecture.md).

## Deploy your own

You need **Node.js 22.13+**, npm, and a Cloudflare account with Workers, D1 and R2 enabled. Model credentials are needed for Add research and Recommend; browsing and recording Visits work without them.

### 1. Install and create resources

```sh
git clone --branch 0.1.0rc1 https://github.com/AndyZhou952/place-atlas.git
cd place-atlas/apps/web
npm ci
cp wrangler.owner-poc.jsonc wrangler.owner-poc.local.jsonc
npx wrangler login
npx wrangler d1 create place-atlas
npx wrangler r2 bucket create place-atlas-media
```

Edit `wrangler.owner-poc.local.jsonc`: replace `d1_databases[0].database_id` with the ID printed by D1 creation. If those names are already in use in your account, choose new names in the creation commands and update the Worker `name`, D1 `database_name` and R2 `bucket_name` in this file. Keep the `DB`/`MEDIA` binding names, migration directory, environment guards and logging settings.

The default template needs no Google key, route Worker or browser service. The local configuration is ignored by Git and used automatically when building. **A fresh database starts empty. This tag preserves the earlier 0.1.0rc1 application; use the stable 0.1.0 tag for the completed release.**

### 2. Apply the schema and set Owner credentials

```sh
npx wrangler d1 migrations apply DB --remote --config wrangler.owner-poc.local.jsonc
npx wrangler secret put ATLAS_OWNER_PASSWORD --config wrangler.owner-poc.local.jsonc
npx wrangler secret put ATLAS_OWNER_SESSION_SECRET --config wrangler.owner-poc.local.jsonc
```

Enter your chosen password at the first prompt. For the session secret, independently generate a random value of at least 32 characters, for example with `openssl rand -hex 32`. Wrangler may ask to create your named Worker when setting its first secret; accept for your own new deployment.

### 3. Deploy

```sh
mkdir -p .wrangler
npx wrangler secret list --config wrangler.owner-poc.local.jsonc > .wrangler/owner-poc-secret-names.json
npm run deploy:owner-poc
```

Open the URL Wrangler prints. Log in through **Owner**, then open **Agent API settings** to test and save your model key, API base URL and model name. The model must support OpenAI-compatible chat completions and tool calls. Settings are encrypted on the server; keys are not saved in browser storage. The web form supports the official DeepSeek and OpenAI endpoints; other compatible endpoints can be configured with deployment settings described in [architecture](docs/architecture.md#deployment-options).

### 4. Try the workflow

Use **Add** to find a restaurant, select the exact branch, review the preview and confirm. Refresh to check the saved record, then add a Visit and a photo. For Japanese restaurants, a full Tabelog main-listing URL can bypass name search. Model and source failures leave unsupported facts unknown.

Search defaults to public providers without a separate key. Japanese listing reads use Firecrawl; an optional `FIRECRAWL_API_KEY` provides your account's quota. Model, reader, storage and optional Google services can incur provider charges.

For deployment-specific address identification, add `ATLAS_PUBLIC_URL` to your local configuration's `vars` using your new URL. Set `NEXT_PUBLIC_SITE_URL` to the same URL when rebuilding for social previews. Refresh the secret-name file after changing secrets.

## Development and benchmarks

From `apps/web`:

```sh
npm run lint
npm run typecheck
npm test
npm run migration:check
```

For local development, put `ATLAS_OWNER_PASSWORD` and `ATLAS_OWNER_SESSION_SECRET` in an ignored `.dev.vars` file, apply the same migrations with `--local`, then run `npm run dev`. Add model credentials through Owner settings or local environment configuration when testing research.

Benchmarks in this release candidate live in `apps/web/evals/`; see the README files in its individual suites. Live results and catalog captures stay in ignored output directories.

## Optional services and upgrades

Google matching, private walking-route services, alternative search and server-managed model configuration are documented in [deployment options](docs/architecture.md#deployment-options).

Before upgrading an existing installation, export its D1 database and keep the backup outside Git:

```sh
npx wrangler d1 export DB --remote --config wrangler.owner-poc.local.jsonc --output atlas-backup.sql
```

Then apply pending migrations and redeploy. Existing local resource names and stored records remain yours. The website and internal package names still use the original Japan Atlas naming; renaming the repository does not rename deployed resources.
