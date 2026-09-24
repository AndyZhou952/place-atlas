# T-05 Non-destructive upgrade and integrated validation

Date: 2026-09-24

## Migration safety gate

`npm run migration:check` now runs the complete local gate through
`verifyImportJobsUpgradeSafety(...)`:

1. active migration membership must exactly match the selected manifest stage;
2. every active migration byte stream must match its reviewed SHA-256;
3. every SQL file below `drizzle/`, including pending/new files, is scanned after
   comments and string literals are removed; `DROP TABLE`, `TRUNCATE`, `DELETE
   FROM`, and `UPDATE ... SET` targeting `import_jobs` are rejected;
4. migration `0000` creates an in-memory D1-compatible SQLite fixture;
5. one synthetic legacy `import_jobs` row containing multibyte, emoji, quote,
   and newline bytes is inserted;
6. the remaining active migrations are applied in packaged order;
7. the table/index schema, row count, SQLite value types, and every column's
   payload bytes must remain unchanged.

The current snapshot upgrade applied:

- `0001_dapper_stranger.sql`
- `0002_funny_wrecker.sql`
- `0003_maintenance_controls.sql`

| Snapshot | Schema SHA-256 | Rows | Payload SHA-256 |
|---|---|---:|---|
| Before | `a329ec667866e88c22063492300ea3c02328788ddb2e2a20248122c87c9e96a6` | 1 | `2437003af8bbe66205aafb5dc0374ffbfac937c52e9a23294de56ef033bdd495` |
| After | `a329ec667866e88c22063492300ea3c02328788ddb2e2a20248122c87c9e96a6` | 1 | `2437003af8bbe66205aafb5dc0374ffbfac937c52e9a23294de56ef033bdd495` |

No published SQL migration or `db/schema.ts` changed. The manifest records the
reviewed hashes; it does not add or activate a migration.

## Test evidence

| Gate | Result |
|---|---|
| `npm run migration:check` | PASS |
| Focused migration and retired-route tests | 8/8 PASS |
| `npm test -- --test-reporter=spec` outside the filesystem/process sandbox | 630/630 PASS in 205.0 s |
| Full `architecture-fitness.test.mjs` | 61/61 PASS in 171.5 s |
| Production architecture manifest check | 1/1 PASS in 10.2 s |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run format:check` | PASS, 377 files |
| `npm run build` | PASS, 373 client-reference modules and 344 server-reference modules |
| `git diff --check` | PASS |

The earlier apparent test hang was isolated to
`product/application/architecture-fitness.test.mjs`. It owns 61 TypeScript
compiler fixtures and the Node file-level reporter prints nothing until the
entire file completes. A 300-second bounded run completed successfully in
171.5 seconds, so this is a slow test file rather than an open handle or deadlock.

Inside the restricted sandbox,
`scripts/assessment-reset-maintenance.test.mjs` cannot start its nested Node
CLI (`spawnSync` returns `EPERM`). The same file passed 3/3 outside that process
sandbox, and the final full 630-test run used that valid environment.

## Visual evidence refresh

T-01 was rerun with production `presentWechatCatalogIntake(...)` output in
Playwright Chromium at 390×844. All five scenarios retained exact text and no
horizontal overflow. The longest rendered case was `warning-conflict` at 281
code points and 494 px content height. See
[`t01-wechat/report.json`](./t01-wechat/report.json).

T-02 was rerun against the production build for loading, signed-out, error,
empty, and actionable-list states. Desktop and 390 px layouts all reported
equal client/scroll widths. Refreshed screenshot hashes and dimensions are in
[`ui/t02-review-render-2026-09-24.md`](./ui/t02-review-render-2026-09-24.md).
The mobile signed-out and list screenshots were visually inspected after the
run; navigation, CTA, evidence disclosure, wrapping, and hierarchy remained
clear.

## Change-surface audit

- No new or modified file under `apps/web/drizzle/`.
- No change to `apps/web/db/schema.ts`.
- No new secret file or secret-shaped value in T-05 code/evidence.
- No Wrangler, deployment, workflow, D1, or R2 configuration change.
- Production build route output contains Owner Review Candidate routes and no
  retired `/api/inbox` route.
