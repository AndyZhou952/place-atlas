# Maintenance

## Deployment gate

Run formatting, lint, type checking, tests, and the relevant deployment preflight. Confirm the intended Wrangler configuration and ensure bundles contain no credentials.

## Database changes

Migrations in `apps/web/migrations/owner-poc` are append-only once deployed. Before a destructive or shape-changing migration: stop new write leases, resolve active writes, record revision and migration hashes, export D1, verify and restore the export into a separate database, and deploy only while the revision is unchanged.

The isolated Agent fixture chain is in `apps/web/migrations/agent-poc` and must never be used as the Owner database.

## Media

R2 objects and D1 media metadata form one logical record. Deletion must remain receipt-backed and retry-safe. Backups must inventory both systems and restores must verify captions, visit links, and object keys.

## Secrets and rollback

Set secrets through masked provider prompts. Never pass values as command arguments or copy them into source, logs, or issues. Prefer blue-green resources and retain the previous Worker, verified database export, and media inventory until public-read, Owner-write, Add, Record, Nearby, and Agent-signature smoke tests pass.
