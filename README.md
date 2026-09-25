# Japan Personal Atlas

Japan Personal Atlas is a private, single-owner map for saving places, recording visits, and finding saved places nearby. Browser and signed Agent clients reuse the same deterministic application workflows.

Read the [Owner manual](docs/user-manual.md) before running the app.

## Current scope

Available today:

- a public read-only map and authenticated Owner mode;
- search, personal state, visits, notes, photos, and photo captions;
- deterministic Add with Google Places matching and preview/confirm;
- Nearby over verified saved places through a private Google route sidecar;
- signed `/jpmap add` and `/jpmap nearby` operations through the bundled OpenClaw plugin.

The repository includes a bounded, model-neutral OpenAI-compatible scalar extractor and a DeepSeek configuration, plus offline place-resolution and enrichment benchmarks. Production research is still disabled until a trusted search/fetch relay is configured and the evaluation gate is run against that complete pipeline. Automatic category, signature-dish, Google-rating, and recommendation enrichment is not implemented yet. Conversational Record and screenshot-to-place intake are also not implemented.

## Local development

Requires Node.js 22.13 or newer.

```bash
cd apps/web
npm ci
npm run dev
```

Before opening a pull request:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

## Bring your own providers

A self-hosted deployment supplies its own Cloudflare account, D1 database, R2 bucket, Google credentials, and Agent credentials. Google Places identifies Add candidates; a private sidecar handles geocoding and walking routes. A model API key alone does not provide web research: the current model adapter only extracts narrowly defined facts from evidence fetched by a separate trusted relay. Keep research disabled until that relay is configured and evaluated.

Start with the [Cloudflare deployment guide](docs/deployment/cloudflare.md). Migrations live in `apps/web/migrations`, provider policies under `apps/web/adapters/providers/policies`, and the OpenClaw package in `packages/openclaw-jpmap`.

## Documentation

- [Documentation index](docs/README.md)
- [Product scope](docs/product.md)
- [Architecture](docs/architecture.md)
- [Intake and evaluation](docs/ingestion-and-evaluation.md)
- [Roadmap](docs/roadmap.md)
- [Maintenance](docs/maintenance.md)
- [Decision log](docs/decisions.md)

Historical implementation plans are kept in Git history and issues, not in the runtime source tree.
