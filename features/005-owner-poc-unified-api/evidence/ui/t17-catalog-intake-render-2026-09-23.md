# T-17 Catalog intake render evidence

- Date: 2026-09-23
- Data: synthetic restaurant and opaque receipt references only; no production
  account, Owner, channel, secret, or private-place data
- Renderer: the repository's existing `satori` + `sharp` dependencies, invoked
  by `apps/web/scripts/render-t17-catalog-intake-evidence.mjs`
- Product seam: the render imports the production
  `presentCatalogIntakePreview` presenter; preview fields, provenance,
  duplicates, unknowns, and warnings are therefore projected through the same
  closed presenter used by Web and Agent output
- Visual system: colors, borders, spacing direction, and 44 px action heights
  reproduce the existing warm editorial tokens in `app/globals.css`

## Artifacts

| State | Viewport | File | SHA-256 |
| --- | --- | --- | --- |
| Complete preview | 1440×1260 | `t17/t17-add-desktop-preview.png` | `d676d0f61c1e9236d20402440404c4ae5aff6c90bb5423a12dc8e904c17aa926` |
| Complete preview | 390×1900 | `t17/t17-add-mobile-preview.png` | `b9c6913c0edfb00c9dd6e647d13d7b619993fe30386123a1bc465293bc29acac` |
| Confirm loading | 1440×1260 | `t17/t17-add-desktop-confirm-loading.png` | `364eefa526670fb307dd4a3f2c5626b3d2dc464551b1896e65878b8755d0d09d` |
| Retryable error | 1440×800 | `t17/t17-add-desktop-retryable-error.png` | `e022663664ca403ceb027adb2fa6fa759799a0c00727fffe0271d3f3242be0b6` |
| Verified success | 1440×800 | `t17/t17-add-desktop-verified-success.png` | `36fd54e397a65d875f954fdc1b71407a7517555846816549226fea889cf5eacd` |
| Needs-review success | 1440×800 | `t17/t17-add-desktop-needs-review-success.png` | `fea1367b5a0fc0b9e385a106f2c771bda8e6d227e4c0a5aa1e3cf3f369a26a8d` |
| Confirm-refresh conflict | 1440×1380 | `t17/t17-add-desktop-confirm-conflict.png` | `8779861c2e31348e6870ebecf7e22578f932590311b361e66cb08fcc218c8d36` |

## Visual inspection

- Desktop and mobile preview show every persisted fact, including Tabelog,
  reservation details, evidence label/time/license/source, possible duplicate,
  unknown field, and warning before the confirm action.
- The 390 px composition stacks search controls without horizontal overflow;
  labels, values, evidence, warning, and both actions remain readable.
- Confirm loading preserves the reviewed preview while the query and all
  competing actions are visibly disabled.
- Retryable error preserves the query and provides a 44 px Retry action.
- Verified success says the place is available on the verified map and Nearby;
  needs-review success says it remains Owner-only and is absent from those
  public reads.
- Conflict visibly changes Preview v4 to refreshed Preview v5, shows the changed
  Tabelog value, says that no write occurred, and presents an explicit second
  confirmation action.
- No gradients, glass effects, decorative motion, emoji controls, or
  hard-coded visual system divergence were introduced.

## Trust boundary

These are real PNG renders, not source-code mockups or reused screenshots, but
they are **not browser screenshots**. The environment still has no reusable
Chrome/Chromium/Playwright browser and no new browser dependency was downloaded.
The PNGs provide pixel evidence for content closure, visual hierarchy, warm
tokens, button size, and the intended responsive composition. They do not prove
browser layout computation, keyboard focus movement, focus-ring painting,
DOM/ARIA exposure, or live-region announcements. Those behaviors remain covered
by the reducer/component contracts and require a future browser smoke to close
the browser-specific evidence gap.
