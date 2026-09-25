# Feature 007 T-02 browser and visual review

Date: 2026-09-24

## Outcome

PASS for the scoped Catalog Intake UI gate.

The checked-in browser harness drove the built Vinext production React/CSS
surface with Playwright 1.63 and its cached Chromium headless shell. API calls
were intercepted only at the HTTP boundary; the page, React components,
reducer, focus behavior, and CSS were the production implementation.

The run covered desktop viewports (`1440px` wide) and a `390×844` mobile
viewport. The JSON report records the viewport, rendered panel geometry,
focus target, live-region text, disclosure state, labels, described-by
references, target sizes, overflow result, and Google attribution placement
for every scenario.

## States inspected

- Loading: `t02-desktop-loading.png`
- Empty/refine: `t02-desktop-empty-refine.png`
- Genuine clarification: `t02-desktop-clarification.png`
- Candidate selection: `t02-desktop-candidate-selection.png`
- Preview with unknown durable facts: `t02-desktop-preview.png`
- Confirmation conflict: `t02-desktop-conflict.png`
- Successful save to Owner review: `t02-desktop-success.png`
- Dependency error/retry: `t02-desktop-dependency-error.png`
- Mobile candidate selection: `t02-mobile-390-candidate-selection.png`
- Mobile preview top: `t02-mobile-390-preview.png`
- Mobile preview scrolled to the save action:
  `t02-mobile-390-preview-confirm.png`

All eleven PNGs were opened at original detail and inspected, not inferred from
source code.

## Runtime accessibility and responsive checks

- Every scenario reported `no_horizontal_overflow: true`.
- Every visible interactive target in the scoped panel was at least `44px`;
  the minimum recorded dimension was exactly `44px`.
- No duplicate IDs, missing input labels, missing `aria-describedby` targets,
  or disclosure-state mismatches were found.
- Loading, empty, clarification, candidate, preview, conflict, success, and
  dependency-error states each exposed the expected polite live-region text.
- Focus moved to the state heading or retry control after each transition.
  The empty-state CTA also returned focus to the restaurant query field.
- Clarification opened the optional correction disclosure, set
  `aria-expanded=true`, linked it with `aria-controls`, and associated all
  three correction fields with the clarification message. Normal candidate
  selection kept the same disclosure collapsed.
- The Google Maps attribution remained inside the candidate container beside
  the candidate radio choice on both desktop and mobile.
- The long Japanese candidate name and address wrapped without clipping. At
  `390px`, the search action and attribution reflowed into full-width rows and
  the preview definition list collapsed to one column.
- The mobile collection is a `358px`-wide scrollport inside the `390px`
  viewport. Its `1rem` outer inset, `1rem` inner padding, and borders leave a
  `322px` Catalog Intake content width; `scrollWidth === clientWidth === 322`,
  so this is intentional containment rather than clipping.
- A dedicated real-viewport screenshot scrolls the collection to the save
  action. `Confirm and save` is visible at `y=380.7`, is `44px` tall, and lies
  fully inside the `390×844` viewport.

The machine-readable results are in
`feature-007-t02-browser-report.json`.

## Visual review

The surface remains aligned with the existing warm editorial direction:
paper-toned surfaces, serif hierarchy, restrained vermilion state accents,
and compact sans-serif supporting copy. It does not drift into a generic SaaS
card grid. Typography and section rules keep the dense preview readable;
loading, empty, error, conflict, and success states remain visually distinct
without introducing a second visual system.

Spacing, alignment, and line wrapping are consistent across the inspected
states. The normal candidate path keeps correction inputs collapsed, while a
real ambiguity expands them in context. Mobile stacking preserves the
candidate-to-attribution relationship and the primary action remains visible.
No visual hard blocker was found in the scoped UI.

The desktop screenshots are scoped element captures. The mobile screenshots
are actual `390×844` viewport captures rather than tall element stitches. A
separate geometry probe confirmed the collection (`z-index: 500`) sits above
the map (`z-index: 0`) and has its own vertical scrollport. The earlier map and
footer interruption was a locator-screenshot compositing artifact for content
outside that scrollport; it does not occur in the user's viewport. The final
top and save-action captures replace that misleading artifact.

## Screenshot integrity

SHA-256:

```text
3561e29369770e7dc97217cab8b45a3ffcc3ee1ffe78f8623c7429058eea00f7  t02-desktop-candidate-selection.png
3e7ba5379725b5e972f5874373eced322a87f88ad0edeed9eb212a752f6acaec  t02-desktop-clarification.png
e3983d8f7629069bddc247a47ce572f41c4c906c992f69360cba09bfbd1a0e2b  t02-desktop-conflict.png
966aca0f508db74075ad9cbb8f8692242cafb57aa98a1049463a7b5c246729ba  t02-desktop-dependency-error.png
d510484b3d2c986de2cef87061a6e5d7018241b2a49e9e36abc79ff993fc33a5  t02-desktop-empty-refine.png
f2f9910060bb02559c03d2f1bacaa70dd8c123c543a9319a905aeca77f6e0ef8  t02-desktop-loading.png
4db70f00fe792bb13aa1bdc1875854d66aa74f22a40ced497bddb89025229d67  t02-desktop-preview.png
f62952ed70be2ee498f6d8d81bfcee28ff5315a0d4f16a412f2e5b27e3b1ac11  t02-desktop-success.png
a04601a014f5c5053053d4078cba5a2b37059b6bed765099ee378a913e9412de  t02-mobile-390-candidate-selection.png
2ac4ae5fbb3b0165b34300e6672d4fe6e400127b481f8ac8f8c27517c8c5e945  t02-mobile-390-preview-confirm.png
5a84da0d022beb4500d50e29e29c3b390624605bdcc9dc8c833ec6702e83f1ed  t02-mobile-390-preview.png
```

## Reproduction

```text
PLAYWRIGHT_BROWSERS_PATH=<cached-browser-directory> \
FEATURE007_BASE_URL=http://127.0.0.1:4317/ \
python scripts/feature-007-catalog-intake-browser-harness.py
```

The local Worker was started from the existing `dist/server` production build.
Because the checked-in Wrangler version bundled an older local `workerd`, this
evidence run used a local-only compatibility-date override (`2026-09-10`). It
did not alter source, the deployed Worker, or production data.
