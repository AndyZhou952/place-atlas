# T-07 Nearby browser UI evidence — 2026-09-21

This record contains only sanitized UI conclusions. The rendered fixture did
not call Google, did not contain private data, and did not expose a deployment
URL, credential, account identifier, or provider response.

## Rendered states

Real Chromium captures were reviewed at desktop and mobile viewports:

- desktop manual-location default state;
- desktop structured resolved result with walking minutes, personal facts,
  warnings, Google attribution, and checked time;
- desktop public Privacy page;
- mobile manual-location default state;
- mobile public Terms page.

The captures are retained in the workspace visualization artifact directory
under `t07-ui/` as `desktop-nearby-default.png`,
`desktop-nearby-resolved.png`, `desktop-privacy.png`,
`mobile-nearby-default.png`, and `mobile-terms.png`.

## Review conclusions

- The existing warm editorial Atlas direction is preserved; the feature does
  not introduce a second visual system.
- The manual location field and action remain visible and legible at both
  viewports. Empty input disables the action; no browser location prompt is
  presented.
- The resolved desktop state keeps the ordered result, route evidence,
  personal visit/rating facts, warnings, attribution, and checked time inside
  the place panel without covering the selected-place card.
- Terms, Privacy, and footer links are visible, readable, and do not clip or
  overlap at either viewport.
- Mobile controls retain the repository's 44 px minimum target contract and
  visible focus styles. Semantic contract tests cover labels, busy/error live
  states, ambiguity, empty results, ordered results, and native policy links.
- Route evidence is rendered as text only and is not passed into Leaflet.

## Verification

- Nearby UI and policy focused contracts: 6/6 passed.
- Browser client/catalog, ViewModel boundary, Nearby UI, and policy regression:
  14/14 passed.
- Full repository test suite, no-cache TypeScript, lint, format check, and Owner
  production build passed after integration.

The development renderer emitted the existing vinext/Base UI input hydration
attribute warning for both the pre-existing catalog search and the new Nearby
input. It did not prevent interaction or alter the captured UI; it remains a
non-blocking framework-integration observation rather than a T-07 data-flow
failure.
