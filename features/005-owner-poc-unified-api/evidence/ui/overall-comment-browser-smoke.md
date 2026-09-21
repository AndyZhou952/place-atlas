# Overall comment browser evidence

- Date: 2026-09-21
- Target: local vinext development build
- Browser: headless Chromium
- Data boundary: browser-intercepted HTTP fixtures matching the public assessment and assessment update contracts; this is UI evidence, not a deployed Cloudflare smoke test.
- Scenario: anonymous public comment display → anonymous save rejected and Owner panel opened → mocked Owner login → delayed save loading state → success → full page reload → saved public comment restored.
- Final interface rerun: repeated save → success → full page reload against the mutation receipt envelope, asserted a non-empty stable `x-atlas-mutation-id`, and restored `Receipt-aware comment survives refresh.` from the subsequent public assessment read.
- Mobile measurement at 390 × 844: textarea 126.09 px high, Save target 44 px high, comment region 332 px wide.

## Screenshots

- `overall-comment-desktop-public.png`
- `overall-comment-desktop-error-owner-login.png`
- `overall-comment-desktop-loading.png`
- `overall-comment-desktop-success.png`
- `overall-comment-desktop-refreshed.png`
- `overall-comment-mobile-editing.png`

## Visual review

- Direction: retains the warm editorial Atlas typography, paper surfaces, vermilion focus/error accent, and restrained rules; no generic login/card pattern was added.
- Hierarchy: the Personal note eyebrow, serif heading, readable comment, and compact edit action sit between ratings and visit facts without competing with the place title.
- States: public/default, loading, error with Owner login, success, refreshed, and mobile editing are represented.
- Accessibility: textarea has a visible label/focus ring, error uses an alert, success uses semantic output/live text, disabled controls prevent duplicate save, and primary mobile action measures 44 px.
- Responsive result: the 390 px layout keeps the editor within the detail sheet with no horizontal overflow.
