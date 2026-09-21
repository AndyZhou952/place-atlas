# Google Route Sidecar deployment gate

This runbook packages and later deploys the private, read-only Google Route
Sidecar. It never stores or prints a Google key. Do not deploy or enable the
Owner Worker service binding until the independent D-P05 security review passes.

## Trust boundary

- `japan-atlas-route-sidecar` exposes only typed RPC methods over a Cloudflare
  service binding. `workers_dev=false`, preview URLs are disabled, routes are
  empty, and an accidental HTTP invocation returns `404`.
- The Sidecar holds only the encrypted raw secret `GOOGLE_MAPS_API_KEY`. It has
  no Owner password/session secret, Agent HMAC secret, D1, R2, KV, Queue,
  Durable Object, service binding, Foursquare, or Transit capability.
- The Owner Worker reserves provider usage in its own D1 before RPC. The keys
  are provider + SKU + UTC month; hard limits are 8,000
  `geocoding.requests` and 8,000 `walking_matrix.elements`. A failed Google
  call is not refunded.
- Only Geocoding and walking Route Matrix are enabled. Transit and Foursquare
  remain unconfigured and must receive zero calls.
- Location hints, coordinates, resolved addresses, raw Google payloads, and
  route payloads are request-only. Do not add them to D1/R2, logs, model
  prompts, or Leaflet. Only usage counters are persistent.

## Local evidence (no network call and no real key)

From `apps/web`:

```sh
npm run test:route-sidecar
npm run build:route-sidecar
npm run typecheck
npm run lint
npm run format:check
```

`build:route-sidecar` is a Wrangler `--dry-run`. It bundles the exact private
entrypoint into ignored `dist/route-sidecar` and does not upload it. Tests use
fake transports only.

## Remote preparation (only after D-P05 approval)

Authenticate Wrangler with the intended Cloudflare account. Set the key as an
encrypted raw secret through an interactive prompt; never place the value in a
command, config, evidence file, shell history, or repository:

```sh
npx wrangler secret put GOOGLE_MAPS_API_KEY --config wrangler.route-sidecar.jsonc
mkdir -p .wrangler
npx wrangler secret list --config wrangler.route-sidecar.jsonc --format json > .wrangler/route-sidecar-secret-names.json
```

The ignored secret-list evidence contains names and types only. Inspect it
before continuing; it must list exactly `GOOGLE_MAPS_API_KEY` as `secret_text`.

## Private-route preflight and strict deploy

Replace `<account-subdomain>` locally; do not commit account identifiers. The
probe follows no redirects and passes only when the endpoint is unreachable or
returns `404`:

```sh
export ROUTE_SIDECAR_PUBLIC_URL='https://japan-atlas-route-sidecar.<account-subdomain>.workers.dev/'
npm run preflight:route-sidecar
npx wrangler deploy --config wrangler.route-sidecar.jsonc --strict
npx wrangler secret list --config wrangler.route-sidecar.jsonc --format json > .wrangler/route-sidecar-secret-names.json
npm run preflight:route-sidecar
unset ROUTE_SIDECAR_PUBLIC_URL
```

Stop if the preflight reports a public route, any extra binding/secret, a
reachable non-404 endpoint, or malformed evidence. Do not weaken the gate.

## Owner binding and negative probe

The Sidecar deployment alone is inert. T-05/T-07 may add exactly one Owner
Worker service binding after their operation contracts pass. Until that
binding exists, `createMeteredRouteSidecarClient` must return
`not_configured` without reserving D1 quota or attempting RPC; this is covered
by the focused contract. Do not add a public HTTP fallback.

After the binding is configured, run both of these before switching OpenClaw:

1. an unbound Worker/client probe that still returns `not_configured` with
   unchanged ledger counters;
2. a bound Owner probe that reserves the correct SKU before RPC and returns
   only closed attribution/evidence.

Keep Google Cloud quota at or below the two application hard caps. Cloud quota
is a second safety gate, not a replacement for the D1 reservation.

## Rollback

Remove the Owner Worker service binding and redeploy that Worker. The client
then fails closed as `not_configured`; the Sidecar can remain deployed but
unreachable. Do not delete or refund historical D1 usage rows.
