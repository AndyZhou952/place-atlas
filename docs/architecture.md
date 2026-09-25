# Architecture

Browser routes and the signed Agent API call one application layer. Provider-specific behavior is isolated behind typed ports, and Cloudflare bindings are assembled at the server boundary.

```text
Browser UI ─┐
            ├─ application operations ─ domain ─ D1/R2 adapters
Agent API ──┘                         └─ provider ports
                                               ├─ Google Places
                                               ├─ durable geocoder
                                               └─ private route sidecar
```

An LLM is not the source of truth. A bounded OpenAI-compatible adapter can extract approved scalar facts from already-fetched evidence; it does not browse or write. Deterministic validation, identity, authorization, idempotency, and persistence remain in the application.

## Stable locations

- `apps/web/app`: HTTP and page entry points.
- `apps/web/features`: browser feature modules.
- `apps/web/product`: domain and application contracts.
- `apps/web/lib/server/application`: server composition and durable services.
- `apps/web/adapters`: D1, provider, and Agent adapters.
- `apps/web/route-sidecar`: private geocoding and route worker.
- `apps/web/migrations/owner-poc`: deployable D1 chain and seed manifest.
- `apps/web/migrations/agent-poc`: isolated Agent fixtures.
- `apps/web/adapters/providers/policies`: provider policy evidence.
- `packages/openclaw-jpmap`: OpenClaw integration.
- `docs/deployment`: operational runbooks.

Runtime code, migrations, fixtures, and policy files must not live in planning/history folders.

## Data and trust

D1 is authoritative for catalog records, review candidates, personal state, visits, notes, receipts, and usage reservations. R2 stores media; D1 stores its metadata. A committed review candidate must remain readable through an Owner surface.

Public reads need no Owner credentials. Browser writes require an Owner session. Agent operations require a scoped HMAC signature. The route sidecar is private and holds only its route-provider credential. Secrets never enter browser bundles, source control, logs, or evidence artifacts.

## Semantic extension seam

The model-neutral research extractor consumes one bounded, untrusted page plus its canonical source URL and returns a schema-validated proposal or an explicit stop/no-evidence result. The included DeepSeek configuration uses the same port as any other OpenAI-compatible provider. It has no direct D1 access and no built-in browsing role.

The separate research relay already owns bounded fetching, deadlines, signed selected-branch binding, and provenance. A production implementation must also add an explicit source policy for search results and every redirect. Production enrichment remains disabled until that policy and a concrete relay/search implementation are configured and pass the checked-in resolution and enrichment benchmarks. Recommendation requires a separate, later contract; it is not implied by the scalar extractor.
