# Cloudflare isolated read-only PoC

This directory is only for the `japan-atlas-agent-poc` fixture environment. It must not reuse the OpenAI Sites project, its D1 database, its R2 bucket, or any production migration.

## Safety gate

STOP: do not deploy until a Cloudflare account is authorized, both isolated resources exist, every placeholder is replaced only in an ignored local config, and the main integration has selected the Agent PoC build target without the Sites plugin.

The checked-in `apps/web/wrangler.agent-poc.jsonc` is a reproducible template. Keep it unchanged. Copy it to `apps/web/wrangler.agent-poc.local.jsonc`, replace only the blocked D1 sentinel `00000000-0000-4000-8000-000000000000` in that ignored copy, and keep account IDs out of evidence.

## Minimum owner actions
Google provider policy is pending_review: even after the secret exists, real Google calls remain disabled until separate policy activation evidence is approved. Never put a key in a command argument, Git, or evidence.

From `apps/web`, authenticate interactively with `npx wrangler login`, then inspect the selected account with `npx wrangler whoami`. Creating the following resources changes Cloudflare state and must be performed only after the owner approves it:

```text
npx wrangler d1 create japan-atlas-agent-poc-fixture
npx wrangler r2 bucket create japan-atlas-agent-poc-media-fixture
```

Copy the returned D1 ID into `wrangler.agent-poc.local.jsonc`. Initialize only that database:

```text
npx wrangler d1 execute japan-atlas-agent-poc-fixture --remote --file ../../features/004-openclaw-atlas-poc/deployment/cloudflare-poc/0001_agent_readonly_fixture.sql
npx wrangler d1 execute japan-atlas-agent-poc-fixture --remote --file ../../features/004-openclaw-atlas-poc/deployment/cloudflare-poc/0002_agent_catalog_seed.sql
npx wrangler d1 execute japan-atlas-agent-poc-fixture --remote --file ../../features/004-openclaw-atlas-poc/deployment/cloudflare-poc/0003_agent_provider_usage.sql
```

Generate a new random HMAC secret. Supply values through an interactive prompt, never as command arguments or committed files:

```text
npx wrangler secret put AGENT_JPMAP_KEY_ID --config wrangler.agent-poc.local.jsonc
npx wrangler secret put AGENT_JPMAP_HMAC_SECRET --config wrangler.agent-poc.local.jsonc
npx wrangler secret put AGENT_OWNER_ACTOR_ID --config wrangler.agent-poc.local.jsonc
npx wrangler secret put AGENT_OWNER_CONVERSATION_ID --config wrangler.agent-poc.local.jsonc
npx wrangler secret put GOOGLE_MAPS_API_KEY --config wrangler.agent-poc.local.jsonc
```

Build and inspect the isolated artifact, refresh the remote secret-name evidence, then run the fail-closed preflight:

```text
npm run build:agent-poc
npx wrangler secret list --config wrangler.agent-poc.local.jsonc --format json > .wrangler/agent-poc-secret-names.json
npm run preflight:agent-poc
```

The preflight rejects a missing local config, the D1 sentinel, absent owner/HMAC secrets, a mismatched built Worker, any production binding, or Sites metadata. Only after it passes may the owner run:

```text
npm run deploy:agent-poc
```

After deployment, save a redacted `wrangler deployments list`, run one signed nearby request, verify one audit row, and replace the estimates in `budget/read-gate-budget.json` with Cloudflare and AWS billing/usage evidence.

## Expected local contract

- Worker: `japan-atlas-agent-poc`
- D1: `japan-atlas-agent-poc-fixture`, binding `DB`
- R2: `japan-atlas-agent-poc-media-fixture`, binding `MEDIA`
- Runtime guard: `ATLAS_DEPLOYMENT_ENV=agent-poc-readonly` and `ATLAS_DATASET=fixture`
- Agent manifest: `jpmap_nearby` only; write, destructive, maintenance, and reset tools remain unavailable
- Cost gate: projection plus reserve must remain at or below USD 60; provider hard quota closes the relevant dependency
