# Cloudflare owner-writable PoC

This is a blue-green successor to the isolated read-only Agent fixture. It
uses a different Worker, D1 database, and R2 bucket. The old Worker and data
remain untouched as the rollback target.

## Stop conditions

Do not run remote commands until the owner has authorized the Cloudflare
account and the main integration has:

- selected `wrangler.owner-poc.jsonc` in a dedicated build mode;
- wired the canonical owner-poc Catalog and personal-facts adapters;
- protected every browser mutation route with owner-session authentication;
- added `wrangler.owner-poc.local.jsonc` to the app gitignore;
- passed the owner-poc build, tests, and independent code review.

Never commit an account ID, database export, secret value, provider response,
or private row. Never place a secret in a command argument.

## 1. Capture rollback evidence

From `apps/web`, authenticate interactively and confirm the selected account.
Save all generated evidence under ignored `.wrangler/`:

```text
npx wrangler whoami
npx wrangler deployments list --config wrangler.agent-poc.local.jsonc
npx wrangler d1 export japan-atlas-agent-poc-fixture --remote --config wrangler.agent-poc.local.jsonc --output .wrangler/agent-poc-before-owner.sql
```

Record redacted row counts for every `agent_*` table and inventory the old R2
bucket. If the old bucket is not empty, stop until a reviewed object-copy plan
has copied and verified every object in the new bucket.

## 2. Create blue-green resources

These commands mutate Cloudflare and require explicit owner approval:

```text
npx wrangler d1 create japan-atlas-owner-poc
npx wrangler r2 bucket create japan-atlas-owner-poc-media
```

Copy `wrangler.owner-poc.jsonc` to the ignored
`wrangler.owner-poc.local.jsonc` and replace only the D1 sentinel with the
new database ID.

Import the old export only into the empty new database, then apply the
owner-poc migration chain:

```text
npx wrangler d1 execute japan-atlas-owner-poc --remote --config wrangler.owner-poc.local.jsonc --file .wrangler/agent-poc-before-owner.sql
npx wrangler d1 migrations apply japan-atlas-owner-poc --remote --config wrangler.owner-poc.local.jsonc
```

The migrations are additive and replay-safe. They preserve all legacy Agent
tables, create the writable Web tables, seed five reviewed records when the
new database is empty, and copy `agent_catalog_items` into canonical
`atlas_items` without overwriting an existing canonical row.

Before deployment, verify that legacy audit, receipt, nonce, and provider-usage
counts match the export; `agent_catalog_items` and `atlas_items` must each
contain the same five seed IDs.

## 3. Store secrets interactively

Set these names through masked Wrangler prompts:

```text
npx wrangler secret put AGENT_JPMAP_KEY_ID --config wrangler.owner-poc.local.jsonc
npx wrangler secret put AGENT_JPMAP_HMAC_SECRET --config wrangler.owner-poc.local.jsonc
npx wrangler secret put AGENT_OWNER_ACTOR_ID --config wrangler.owner-poc.local.jsonc
npx wrangler secret put AGENT_OWNER_CONVERSATION_ID --config wrangler.owner-poc.local.jsonc
npx wrangler secret put ATLAS_OWNER_PASSWORD --config wrangler.owner-poc.local.jsonc
npx wrangler secret put ATLAS_OWNER_SESSION_SECRET --config wrangler.owner-poc.local.jsonc
```

The session secret must be independently generated. `GOOGLE_MAPS_API_KEY` must
never be attached to this owner Worker. It belongs only to the future isolated
Route Sidecar, after its separate security gate; any key shared in chat must be
rotated before that later deployment.

Save secret names only:

```text
npx wrangler secret list --config wrangler.owner-poc.local.jsonc --format json > .wrangler/owner-poc-secret-names.json
```

On a fresh target, the first `wrangler secret put` can create a placeholder Worker
using Wrangler's default configuration. This is expected; do not modify or deploy
the old Worker.

## 4. Build, preflight, and deploy

Build first. Then, immediately before preflight, query the canonical
`atlas_items` rows from the target D1 selected by
`wrangler.owner-poc.local.jsonc`. Keep the raw Wrangler output separate and
wrap it with that config's D1 `database_id` and the current capture time:

```text
npm run build:owner-poc
npx wrangler d1 execute japan-atlas-owner-poc --remote --config wrangler.owner-poc.local.jsonc --command "$(cat scripts/owner-poc-seed-evidence.sql)" --json > .wrangler/owner-poc-seed-rows.json
node --experimental-strip-types scripts/owner-poc-seed-evidence-envelope.ts --config wrangler.owner-poc.local.jsonc --rows .wrangler/owner-poc-seed-rows.json > .wrangler/owner-poc-seed-evidence.json
npm run preflight:owner-poc
```

Use query mode for seed evidence. Wrangler's `--file ... --json` output reports
upload progress and execution summary rather than returning the selected rows.

Do not reuse the evidence file for a later preflight or a different database.
Preflight requires the evidence database ID to equal the current target D1 and
the capture time to be no more than five minutes old. It compares the remote
canonical payloads with `owner-poc-seed-v1.json`, the persisted D1 manifest,
and the pinned source artifact SHA-256. A missing or changed canonical row,
even when the legacy row is unchanged, blocks deployment.

Preflight rejects the D1 sentinel, mismatched blue-green bindings, missing
owner/Agent secret names, seed drift, Sites metadata, the old fixture binding,
and any Google, Transit, or Foursquare runtime metadata or secret.

If secret setup created a fresh placeholder Worker and preflight passed,
bootstrap that new owner Worker exactly once without strict mode, then
immediately repeat the same deployment with strict mode:

```text
npx wrangler deploy --config dist/server/wrangler.json
npx wrangler deploy --config dist/server/wrangler.json --strict
```

The non-strict command is only for replacing that fresh placeholder's default
configuration. Later deployments use strict mode only:

```text
npx wrangler deploy --config dist/server/wrangler.json --strict
```

Both commands target only the new owner-poc config. The old Worker remains untouched
as the rollback target.

## 5. Smoke test and cut over

Keep the old URL live. Against the new URL, verify in order:

1. anonymous browser writes are rejected and do not change row counts;
2. owner login permits favorite, visited, rating, Visit, and media writes;
3. refresh reads the same persisted state;
4. a signed Agent Nearby call reads canonical `atlas_items` and the same
   assessment and Visit facts, but returns the route-service-pending response;
5. verify the SKU ledger migration separately. Do not run a Google probe until
   the future Sidecar and structured Nearby tickets pass their own review.

Only then switch the shared link or custom route to the new Worker.

## Rollback

Before any owner write, rollback means switching traffic back to the untouched
read-only Worker and D1. Do not delete the new resources.

After any owner write, never restore the old export over the new database.
Disable new writes, retain the new D1/R2 data, switch reads back only if the
product impact is understood, and fix forward. Legacy `agent_catalog_items`
remains available for the old read-only Worker during the soak period.
