# T-04 deployment and Owner demo runbook

- Status: prepared only; no deployment or production mutation was performed by
  the local integration agent.
- Run from `apps/web` on the reviewed commit.
- Stop on any preflight or smoke failure. Never print or commit secret values,
  private queries, coordinates, provider bodies, Owner identifiers, or private
  Catalog rows.

## 1. Rebuild and refresh name-only evidence

```sh
WRANGLER_LOG_PATH=/tmp/japan-atlas-feature007-wrangler.log npm run build:route-sidecar
WRANGLER_LOG_PATH=/tmp/japan-atlas-feature007-wrangler.log npm run build:owner-poc
mkdir -p .wrangler
npx wrangler secret list --config wrangler.route-sidecar.jsonc --format json > .wrangler/route-sidecar-secret-names.json
npx wrangler secret list --config wrangler.owner-poc.local.jsonc --format json > .wrangler/owner-poc-secret-names.json
```

Inspect names only. Route Sidecar must contain exactly
`GOOGLE_MAPS_API_KEY`; Owner Worker must keep its reviewed seven-name allowlist
and must not contain `GOOGLE_MAPS_API_KEY`.

## 2. Preflight and deploy the private Route Sidecar

Set the existing account subdomain only in the local shell; do not commit it.

```sh
export ROUTE_SIDECAR_PUBLIC_URL='https://japan-atlas-route-sidecar.<account-subdomain>.workers.dev/'
npm run preflight:route-sidecar
npx wrangler deploy --config wrangler.route-sidecar.jsonc --strict
npx wrangler secret list --config wrangler.route-sidecar.jsonc --format json > .wrangler/route-sidecar-secret-names.json
npm run preflight:route-sidecar
unset ROUTE_SIDECAR_PUBLIC_URL
```

The public probe must be DNS-unreachable or HTTP 404. Any public route, extra
binding, extra secret, redirect, or non-404 reachable response is a STOP.

## 3. Capture fresh D1 evidence and deploy the Owner Worker

These commands must be consecutive. The final evidence must be no more than
five minutes old when preflight runs.

```sh
npx wrangler d1 execute japan-atlas-owner-poc --remote --config wrangler.owner-poc.local.jsonc --command "$(cat scripts/owner-poc-seed-evidence.sql)" --json > .wrangler/owner-poc-seed-rows.json
node --experimental-strip-types scripts/owner-poc-seed-evidence-envelope.ts --config wrangler.owner-poc.local.jsonc --rows .wrangler/owner-poc-seed-rows.json > .wrangler/owner-poc-seed-evidence.json
npm run preflight:owner-poc
npx wrangler deploy --config dist/server/wrangler.json --strict
```

Record only the reviewed commit, redacted build/deployment identifier, fixed
endpoint/SKU names, quota decision, and normalized result class. Do not record
Cloudflare resource IDs in committed evidence.

## 4. Read-only deployment smoke

- Public root and policy pages return HTTP 200.
- Anonymous Catalog Intake write returns HTTP 401.
- Owner login succeeds without placing the password in a command or log.
- Owner Worker configuration still has exactly one private `ROUTE_SIDECAR`
  service binding and no direct Maps key.

## 5. Owner-visible acceptance

### Web Add

1. Search `讃岐うどん大使 東京麺通団`.
2. Select the intended candidate without opening `Correct details`.
3. Verify preview shows location/Tabelog/reservation as known or honest
   `Unknown`; it must not ask for the same name/area/address again.
4. Confirm once. Verify one Review Candidate and one receipt, then replay the
   same confirm and verify no duplicate.

### WeChat Add

Send in the Owner DM:

```text
/jpmap add 讃岐うどん大使 東京麺通団
/jpmap add select 1
/jpmap add confirm
```

The select response must be a concise preview and must not contain
`Add a restaurant name, area, or address to continue.` Confirm creates one
Review Candidate/receipt. In a separate session, verify `/jpmap add cancel`.

### Nearby

1. Enter `池袋` in Web Nearby.
2. Verify the request reaches geocoding and Routes through the private Sidecar
   and returns the pre-verified saved Ikebukuro item.
3. Capture one true `not_found` response with refine-address guidance.
4. If a dependency is deliberately unavailable, verify the UI says no saved
   places were checked, preserves the input, and offers explicit Retry.

## 6. UI evidence

On a machine with an already-installed Playwright Chromium runtime, start the
built Owner surface locally, set `FEATURE007_BASE_URL`, and run:

```sh
python3 scripts/feature-007-catalog-intake-browser-harness.py
```

Commit the generated desktop/390 screenshots and report only after visually
checking every screenshot and verifying the JSON contains no overflow,
duplicate IDs, missing descriptions/labels, undersized targets, or misplaced
Google attribution.

T-04 stays unchecked until all three real chains and the UI evidence are
accepted by the Owner.
