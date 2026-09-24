# T-07 Tabelog + personal rating regression evidence

Date: 2026-09-24

## Outcome

PASS. A verified Add-style item whose external Tabelog score exists only in
`intakeEvidence.tabelog` keeps that score when the Owner saves a personal
rating. The mutation response, immediate ViewModel state, Catalog read-back,
and full page reload all show Tabelog `3.87` beside personal score `3.5`.

No deployment or production mutation was performed for this evidence run.

## Root cause

Catalog Intake persists source-backed Tabelog evidence under
`AtlasItem.intakeEvidence.tabelog`. The anonymous Catalog read projection
promoted that evidence into the browser's `item.tabelog` display field, but
`assessment.update` previously returned the unpromoted Catalog object. The
ViewModel then treated this narrower personal-write response as a complete
replacement, so the Tabelog badge disappeared until a reload.

The fix closes both sides of the mismatch:

1. `catalog-projection.ts` promotes known intake Tabelog evidence into the
   stable Catalog item projection used by list/get and mutation responses.
2. `atlas-view-model-state.ts` settles personal mutations by applying only
   personal-owned fields (`personalRating`, `isFavorite`, `hasVisited`, and
   `overallComment`) to the existing Catalog base. A personal write can no
   longer replace address, Tabelog, source links, or other Catalog facts.

## Persistence finding

This was a transient response/state overwrite, not D1 loss.

- `D1PlaceAssessmentState.save` writes only `place_assessments`.
- Tabelog evidence remains inside the stored `atlas_items.payload_json` and is
  unchanged by assessment writes.
- The T-07 integration regression reads the Catalog again after the mutation
  and asserts both `personalRating === 3.5` and the original intake Tabelog
  evidence/value.

## Automated evidence

### One full regression path

Command:

```text
node --experimental-strip-types features/atlas/t07-tabelog-personal-rating.integration.test.mjs
```

Result: `1/1` passed. The test covers:

- initial Add-style Catalog read: Tabelog `3.87`;
- the real Web assessment HTTP adapter with `overallRating: 3.5`;
- mutation receipt response: both values present;
- immediate optimistic/settled ViewModel: both values present;
- Catalog reload/read-back: both values present and raw intake evidence equal
  to the original source assertion.

### Regression and affected-chain tests

- Place assessment operations: `8/8` passed.
- Atlas ViewModel state: `10/10` passed.
- Catalog read: `5/5` passed.
- D1 assessment adapter: `2/2` passed.
- Browser AtlasApplication: `7/7` passed.
- Architecture fitness: `61/61` passed (`161.7s`).
- All remaining product, provider, route-sidecar, and scripts test files:
  `58` files covered; `57/58` passed in the restricted sandbox. The sole
  restricted failure was the existing maintenance CLI test receiving empty
  child-process output because nested process spawning was sandbox-blocked;
  rerunning that unchanged test outside the process sandbox passed `3/3`.
- The first aggregate partition (test files 1–103) passed before the runner was
  manually split at the long, silent architecture-fitness file. Across the
  three partitions, every repository test file was executed successfully.

### Static/build gates

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run format:check`: passed across 379 files.
- `npm run build`: passed; production route list contains no retired Inbox
  route.
- `npm run migration:check`: passed for candidate site version 17.

## Browser evidence

Harness:

```text
PLAYWRIGHT_BROWSERS_PATH=/tmp/jpmap-playwright-GeR7rb/browsers \
T07_PLAYWRIGHT_ROOT=/tmp/jpmap-playwright-GeR7rb \
T07_BASE_URL=http://127.0.0.1:4319/ \
node scripts/t07-tabelog-personal-rating-browser-smoke.mjs
```

The production React/CSS page was exercised at `1440×1000`. The harness made
one Owner assessment PATCH, asserted both ratings immediately, reloaded the
page, and asserted both ratings again.

- List, immediate: `マイ 3.5` and `食べログ 3.87`.
- Detail, immediate: `マイスコア 3.5` and `食べログ 3.87`.
- List and detail after reload: same values.
- Report: `evidence/ui/t07-tabelog-personal-rating-report.json`.
- Screenshot: `evidence/ui/t07-tabelog-and-personal-rating-desktop.png`.
- Screenshot SHA-256:
  `43ea66c6defd8edf369f2496a5749f02029352fc4ce9e2dbbe420bde09d2e999`.

The screenshot was visually inspected: both values are legible in the list and
detail panel with no overlap or horizontal overflow.
