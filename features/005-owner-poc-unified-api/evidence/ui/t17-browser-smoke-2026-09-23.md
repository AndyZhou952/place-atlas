# T-17 production browser smoke evidence

- Date: 2026-09-23
- Browser: Playwright Chromium 1243, headless
- Product surface: the running Vinext application and production React
  `CatalogIntakePanel`; this is not a parallel HTML/color mock
- Test boundary: Owner authentication and catalog-intake HTTP responses were
  intercepted with synthetic fixtures. React rendering, reducer transitions,
  keyboard/click interaction, focus movement, ARIA exposure, computed CSS, and
  the scrollable production collection panel were exercised in Chromium.
- Privacy: fixtures contain no production Owner, channel, secret, or private
  place data.

## Artifacts

| State | Browser capture | SHA-256 |
| --- | --- | --- |
| Desktop complete preview, top | `t17-browser/t17-desktop-preview.png` | `12fe36dfa4e9343065f062aecb9a909f930d89a7a720cfac0200002c519253ff` |
| Desktop complete preview, actions | `t17-browser/t17-desktop-preview-actions.png` | `5983fb39736806f6a5b02a6d7ea70e63b9ce74f43ea11aebdaabca42e22552a3` |
| Mobile complete preview, top | `t17-browser/t17-mobile-preview.png` | `425f16b2323c04fcd73056e41a35af7606cc71ef8ead0f5d87e04a55e943003d` |
| Mobile complete preview, actions | `t17-browser/t17-mobile-preview-actions.png` | `10ae31b3456ee26055cf3d7359705b77923535faa898f099b3d457fd02a91b80` |
| Confirm loading | `t17-browser/t17-confirm-loading.png` | `6ca13814587483cc04e3737d7d852d6a7ca14982da1077394bb036605dc5686e` |
| Retryable error | `t17-browser/t17-retryable-error.png` | `59b943e4e11de42bf7520948e72a4f9683825186d757cbf8199690839df998a2` |
| Verified success | `t17-browser/t17-verified-success.png` | `18bfd0c016be8559e1c2eed4dff02eadfc864c1538de03d6f4d58f16a1e40b0a` |
| Needs-review success | `t17-browser/t17-needs-review-success.png` | `9162b7f35dce99f56f5cb692a839c6448f29e62d75b0ea74942b6f6c001ab107` |
| Confirm-refresh conflict, top | `t17-browser/t17-confirm-conflict.png` | `176e05ba8464c0b1eafc65eee197fafddb7d019458867082a01e93daab27d446` |
| Confirm-refresh conflict, second action | `t17-browser/t17-confirm-conflict-action.png` | `6deab5130e091e4b57a84d7eee875b00fcb3053d7c7b6d76796f4e9fd56fd55f` |
| Machine-readable browser report | `t17-browser/t17-browser-smoke-report.json` | `34ca5cbd256fa17c8793c14ff16a52267d06f8f34419a054058b9d5f9207eefb` |

The production collection panel is deliberately scrollable. Paired top/action
captures show the actual scroll viewport at both the refreshed facts and the
decision control instead of presenting a stitched full-height mock.

## Browser assertions

- The desktop panel measured 381 px client/scroll width and the mobile panel
  measured 322 px client/scroll width, so neither preview had horizontal
  overflow.
- Computed presentation used the production warm background
  `rgb(251, 248, 241)`, red top border `rgb(189, 64, 37)`, and the production
  Inter/Helvetica/Arial font stack.
- Keyboard discovery reached a visible `Source` link whose Chromium-computed
  focus outline was `auto`/`1px`. Preview construction, initial confirmation,
  retry, and conflict reconfirmation were performed through actual controls.
- Loading exposed `aria-busy=true`, retained Preview v4, and disabled the
  query, Find matches, Confirm, and Cancel controls.
- Retryable error exposed an alert, moved focus to `Add needs attention`, kept
  the input, and provided a Retry control at least 44 px tall.
- Verified and needs-review success exposed polite status output and moved focus
  to `Place saved`. Their copy distinguishes public Catalog/Nearby visibility
  from Owner-only review.
- Conflict exposed an alert, moved focus to `Preview changed`, rendered the
  refreshed Preview v5 and changed Tabelog `4.25 · 338 reviews`, stated that no
  write occurred, and required the 44 px explicit `Review changed preview and
  confirm again` action. The smoke clicked that action and observed the final
  verified success.
- Chromium ARIA snapshots for every state are retained verbatim in the JSON
  report, including provenance links, duplicates, unknowns, warnings, disabled
  controls, alerts, and status regions.

## Reproduction

With the application running locally, point `T17_PLAYWRIGHT_ROOT` at a directory
whose `node_modules` contains Playwright, set `PLAYWRIGHT_BROWSERS_PATH` to its
browser cache, and run:

```sh
T17_BASE_URL=http://127.0.0.1:4317/ \
  node apps/web/scripts/t17-catalog-intake-browser-smoke.mjs
```

The earlier Satori render remains useful auxiliary visual evidence, but it is
not used as proof for the browser-specific claims above.
