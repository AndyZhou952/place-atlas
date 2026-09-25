# T-04 local integration evidence — 2026-09-24

## Outcome

T-01 through T-03 are integrated locally. T-04 remains open because deployment,
real Owner Browser interaction, real WeChat delivery, and the live Ikebukuro
route check have not yet been performed.

## Integrated behavior

- A durable-geocoder `no_match` produces a needs-review Add preview without
  asking the Owner to repeat the restaurant name, area, or address.
- A stable `no_match` confirms once and publishes one Review Candidate/receipt;
  a provider outage at confirm fails immediately with `failed_no_write` and
  leaves the session and Catalog unchanged.
- Browser and signed Agent fixtures share the same Add operation outcomes; the
  production WeChat presenter does not emit the removed repeat-input prompt.
- The Web Add panel keeps corrections optional and collapsed, presents unknown
  restaurant facts honestly, and exposes loading, retry, conflict, and success
  feedback.
- Nearby distinguishes a legitimate `not_found` from
  `dependency_failure`; only the latter says no saved places were checked and
  offers an explicit retry.
- Owner production composition injects the private Route Sidecar binding and an
  operational allowlisted recorder. Its events go only to the dedicated
  structured `nearby_diagnostic` operations log; they do not enter ordinary
  application logs, product operations, presenters, D1, or R2. Owner metering
  continues to own binding/quota classes.

## Local gates

| Gate                                                 | Result                                       |
| ---------------------------------------------------- | -------------------------------------------- |
| Feature 007 focused contracts                        | PASS                                         |
| Updated Catalog aggregate contracts                  | PASS (40/40)                                 |
| Web/Agent D1 dual-adapter E2E                        | PASS                                         |
| Owner composition + private service binding          | PASS                                         |
| TypeScript typecheck                                 | PASS                                         |
| oxlint                                               | PASS                                         |
| oxfmt check                                          | PASS                                         |
| Full `npm test` outside sandbox                      | PASS; dot reporter completed with no failure |
| Architecture fitness                                 | PASS                                         |
| Provider-policy evidence and gateway                 | PASS (13/13)                                 |
| Migration packaging check, candidate site version 17 | PASS                                         |
| Route Sidecar dry-run build and bundle preflight     | PASS; 17.25 KiB / 4.35 KiB gzip              |
| Owner PoC production build                           | PASS                                         |
| Assessment reset safety test                         | PASS (3/3 outside sandbox)                   |

The first sandboxed full-suite run reported the assessment-reset test as a
failure because nested `spawnSync` returned `EPERM` with empty output. Running
that unchanged safety test outside the sandbox passed 3/3, proving an execution
restriction rather than a product regression.

## Historical browser evidence limitation (superseded)

At this integration checkpoint, the checked-in production React/CSS browser
harness was invoked once, but that execution environment had no
Chromium/Chrome/headless-shell executable, no Python Playwright, and no Node
Playwright/Puppeteer package. The filesystem also had less than 700 MB free.
Per the no-download constraint, no browser was installed and no screenshot or
accessibility result was fabricated. Static harness, React/CSS, ViewModel,
disclosure, attribution, target-size, and dual-state contracts passed.

This limitation is historical and no longer represents the current UI evidence
gate. A later browser-capable run superseded it with 11 real rendered PNGs and
the machine-readable accessibility/overflow report in
[`ui/t02-browser/feature-007-t02-browser-report.json`](ui/t02-browser/feature-007-t02-browser-report.json).
The screenshot inventory and independent findings are recorded in
[`ui/t02-browser/feature-007-t02-visual-review.md`](ui/t02-browser/feature-007-t02-visual-review.md).
The previously planned `feature-007-t02-browser-blocker.json` was therefore not
retained as current evidence; the report and visual review above are the
authoritative browser artifacts.

## Still required for T-04

1. Deploy the private Route Sidecar, then the Owner Worker, using fresh remote
   secret-name and D1 seed evidence.
2. Web Owner smoke: choose a candidate without retyping, preview, confirm once,
   and observe one Review Candidate/receipt.
3. Real WeChat smoke: `/jpmap add ...`, `select 1`, preview, confirm, plus cancel
   as the negative path; verify the removed repeat-input prompt never appears.
4. Web Nearby smoke with `池袋`: prove geocoding reaches Routes and returns the
   previously verified saved Ikebukuro item. Also capture one legitimate empty
   result and one dependency-failure retry state.
5. ~~Capture desktop and 390 px screenshots plus the harness accessibility and
   overflow JSON in an environment with an already-installed browser.~~
   Completed by the superseding 11-image report and visual review linked above.

No secret value, private query, coordinates, provider body, private Catalog
fact, Cloudflare resource identifier, or Owner identifier is recorded here.
