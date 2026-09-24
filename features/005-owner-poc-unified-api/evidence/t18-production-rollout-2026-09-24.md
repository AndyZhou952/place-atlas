# T-18 production rollout evidence — 2026-09-24

## Scope and privacy

- Release source: merged `main` commit `9d2ef32` from GitHub PR #15.
- GitHub `validate-web` completed successfully before rollout.
- No secret value, Cloudflare account/resource ID, raw provider response,
  private D1 row, or user message is recorded here.
- Operator-only deployment inventories, the before-D1 export, seed rows, and
  aggregate probes remain under ignored `apps/web/.wrangler/`.
- Research Relay remains `relay_disabled_manual_unknown`; no Tabelog or
  booking-site automation was enabled.

## Cloudflare and D1

- Captured an ignored pre-migration Worker deployment inventory and owner-poc
  D1 export.
- Remote pending-migration inspection showed exactly `0006`–`0009`; all four
  additive migrations applied successfully.
- Provisioned `GOOGLE_PLACES_API_KEY` through Wrangler's masked Secret prompt.
  The refreshed name-only inventory contained the exact reviewed seven names.
- Fresh seed evidence and the owner-poc deployment preflight passed after the
  migration and Secret update.
- Uploaded immutable Worker tag `t18-9d2ef32` with strict mode, placed it at
  0% beside the then-current version, and addressed it through the production
  URL with `Cloudflare-Workers-Version-Overrides`.

Zero-traffic Browser/Add smoke:

- public Terms and Privacy: HTTP 200 with the expected Google policy markers;
- anonymous Catalog Intake write: HTTP 401;
- Owner login: HTTP 200;
- Google Places discover: `candidates_ready`, one closed candidate, visible
  unmodified `Google Maps` attribution;
- select with explicit public Owner address fields: `preview_ready`;
- cancel: `cancelled`, so the probe published no Catalog item;
- aggregate D1 evidence: zero active rows for the cancelled session, one
  minimal cancelled terminal row, and Search Text/Place Details reservations
  present before provider egress.

The deployment preflight verified that durable-geocoder mode was enabled. The
pinned, reviewed release deployed by that rollout contains the fixed
production Nominatim identity and contracts for one application-wide
Nominatim request per second through D1, a 30-day D1 cache, the replaceable
`DurableGeocoderPort` seam, and the closed
`sourceUrl`/`license`/`checkedAt` provenance shape. A later production probe
using a public restaurant name and address still produced
`locationEvidence.status = unknown`; an address-only attempt reached the
documented clarification path. Both sessions were cancelled and published no
Catalog item. Consequently the contract/configuration evidence is present,
but a successful live Nominatim observation is not yet claimed.

The version was promoted to 100%; the ordinary production URL returned HTTP
200 for the root and Terms pages and exposed the new Add/policy markers.

## Worker rollback rehearsal

The first rehearsal deliberately exposed an operator mistake: an inventory
entry captured before the final `secret put` returned HTTP 500 and was
immediately removed from traffic. No data restore or reverse migration was
attempted. Cloudflare Secret updates create a new version, so the correct
rollback candidate was the post-secret, pre-release version.

The corrected candidate was first placed at 0% and returned HTTP 200 through a
version override. It was then assigned 100% traffic and the ordinary root URL
returned HTTP 200. The T-18 version was restored to 100%, after which root and
Terms again returned HTTP 200. The corrected prior version remains at 0% for
an immediate code/config rollback; D1/R2 remain fix-forward state.

## Lightsail and OpenClaw

- Host preflight passed: Node `26.7.0`, OpenClaw `2026.7.1`, and in-memory
  `node:sqlite` all matched the reviewed matrix.
- Local and remote package SHA-256 matched for the 0.3.0 archive.
- Preserved an owner-only rollback archive of plugin 0.2.0, then installed
  0.3.0.
- Runtime inspection: status loaded, command `jpmap`, capability mode `none`,
  and no model-selectable tool.
- The service environment and both rollback snapshots are `0600` and owned by
  the service account. The atomic helper switched only the three target fields
  while preserving exactly five reviewed `JPMAP_*` names.
- Gateway restart completed with an active service.

Zero-model signed host probes against the owner Worker passed:

- Nearby: `银座`, `銀座`, and `ginza` all returned available closed replies;
- Add discover and Add cancel both returned available closed replies;
- URL-shaped input and a second sender were blocked before Worker egress;
- threaded/group context was blocked;
- an exact nonce replay returned HTTP 401;
- a wrong actor context and an unavailable tool/scope returned HTTP 403.

The OpenClaw environment was rolled back to the prior endpoint, the Gateway
restarted, and multilingual Nearby remained healthy. It was then atomically
restored using a new backup, restarted, and Nearby plus Add discover/cancel
passed again. One-time endpoint/key/HMAC input files were deleted; protected
environment snapshots and the plugin rollback archive were retained.

## Remaining acceptance gate

- The transport and command path are live, but the owner must still send real
  WeChat DM commands to prove delivery through the official WeChat connector:
  `/jpmap nearby 银座`, one `/jpmap add ...`, and `/jpmap add cancel`.
- Google Places API enablement is proven by the live probe. Google Cloud
  console application restriction, provider quota, and budget-alert evidence
  were not available to this rollout. Until reviewed, the compensating
  controls are the encrypted Worker Secret, Places-API-only intent, no raw
  logging/persistence, and the lower D1-backed request/cost hard caps.
- One production Add selection must return known
  `durable_geocoder_observed` evidence with an official OpenStreetMap source,
  non-empty license, and valid `checkedAt`; the current live result is
  fail-soft `unknown` and must be investigated or explicitly accepted as a PoC
  limitation.
- T-08 and T-11 remain unchecked until the real WeChat DM result is accepted.
  T-18 additionally remains unchecked until the live durable-geocoder result
  and Google Console restriction/quota/budget evidence are resolved.
