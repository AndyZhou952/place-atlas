# Decision log

## D-001 — Single-owner PoC

Public visitors may read. Mutations require the Owner session or scoped signed Agent identity. Multi-user editing is outside current scope.

## D-002 — One workflow per operation

Every operation exposed to both browser and chat must share one application workflow. Add and Nearby already follow this rule. Conversational Record is not implemented yet; when added, chat may translate input but must not fork Record business rules.

## D-003 — Deterministic core, semantic edge

Authorization, validation, identity, idempotency, persistence, and ranking constraints remain deterministic. Models may interpret or research through typed tools and return validated proposals.

## D-004 — Saved collection only for Nearby

Nearby ranks verified places already saved by the Owner; provider search must not silently broaden the collection.

## D-005 — Durable evidence and explicit unknowns

Unknown fields remain unknown. External ratings and reservation claims require source and observation time. Model prose alone is not durable evidence.

## D-006 — Cloudflare production shape

The PoC uses a Worker, D1, R2, and private route sidecar. Adapters keep another host possible later.

## D-007 — Stable operational assets

Migrations, fixtures, policies, integration packages, and runbooks live beside operated code. Historical plans live in Git history and issues, not `/features`.
