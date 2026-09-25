# Cloudflare self-hosting

This is a bring-your-own-account deployment using Cloudflare Workers, D1, R2, service bindings, and Wrangler. Review names, quotas, and data-region requirements before using private data.

## Components

- Owner Worker: browser, APIs, authentication, Add, Record, and Agent tools.
- Owner D1: catalog, review candidates, personal facts, visits, receipts, and usage counters.
- Owner R2: private media objects.
- Route sidecar: private Google geocoding and walking-route calls.
- Optional OpenClaw host: `packages/openclaw-jpmap` forwards exact `/jpmap` commands.

Google Places identifies Add candidates. The sidecar uses Google Geocoding and Routes. These remain independent server-only bindings even if a PoC uses one Google project. Restrict credentials and set provider budgets.

The repository includes an experimental OpenAI-compatible scalar extractor with a DeepSeek configuration, but it is intentionally not wired into the production composition. A model key alone does not enable enrichment or web search. A deployment must first provide an allowlisted search/fetch relay, keep credentials server-side, and pass the repository benchmarks with live pipeline predictions.

## Deployment outline

1. Install dependencies in `apps/web` and run the local quality gate.
2. Create D1 and R2 resources; copy the Wrangler template to its ignored local counterpart and replace resource identifiers.
3. Apply `apps/web/migrations/owner-poc` in order.
4. Create strong Owner-session and Agent-signing credentials and set required secrets through masked Wrangler prompts.
5. Deploy and verify the private sidecar using [route-sidecar.md](route-sidecar.md).
6. Build the Owner Worker, capture seed evidence, run `npm run preflight:owner-poc`, and deploy only when it passes.
7. Smoke-test public reads, Owner writes, Add visibility, Record media, Nearby, and signed Agent commands.

The guarded sequence, exact secret names, and rollback steps live in `apps/web/migrations/owner-poc/README.md`. Never paste secret values into configuration, shell history, docs, or fixtures.
