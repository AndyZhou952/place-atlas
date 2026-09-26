import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { presentCatalogIntakePreview } from '../../product/application/catalog-intake/catalog-intake-preview-presenter.ts';

test('Feature 007 makes candidate selection primary and keeps optional corrections collapsed', async () => {
  const panel = await readFile(
    new URL('./catalog-intake-panel.tsx', import.meta.url),
    'utf8',
  );

  assert.match(panel, /<details[\s\S]*className="catalog-intake-corrections"/u);
  assert.match(panel, /<summary[\s\S]*Correct details/u);
  assert.match(panel, /aria-expanded=\{correctionsOpen\}/u);
  assert.match(panel, /aria-controls="catalog-intake-correction-fields"/u);
  assert.match(panel, /id="catalog-intake-correction-fields"/u);
  assert.match(panel, /useState\(showClarification\)/u);
  assert.match(panel, /open=\{correctionsOpen\}/u);
  assert.match(panel, /Review selected place/u);

  for (const label of ['Confirmed name', 'Area', 'Address']) {
    assert.match(panel, new RegExp(`<label[^>]*>${label}</label>`, 'u'));
  }
});

test('Feature 007 opens corrections only when a real clarification is required', async () => {
  const panel = await readFile(
    new URL('./catalog-intake-panel.tsx', import.meta.url),
    'utf8',
  );

  assert.match(
    panel,
    /const \[correctionsOpen[\s\S]*useState\(showClarification\)/u,
  );
  assert.match(panel, /<summary[\s\S]*aria-describedby=\{clarificationId\}/u);
  assert.match(panel, /aria-invalid=\{[\s\S]*showClarification/u);
});

test('Feature 007 groups preview facts and stays honest about unavailable research', async () => {
  const panel = await readFile(
    new URL('./catalog-intake-panel.tsx', import.meta.url),
    'utf8',
  );

  for (const heading of ['Place', 'Location', 'Restaurant facts', 'Warnings']) {
    assert.match(
      panel,
      new RegExp(`(?:heading: '${heading}'|>${heading}<)`, 'u'),
    );
  }
  assert.match(panel, /catalog-intake-preview-group/u);

  const presentation = presentCatalogIntakePreview(unknownPreview());
  const tabelog = presentation.fields.find((field) => field.key === 'tabelog');
  const reservation = presentation.fields.find(
    (field) => field.key === 'reservation',
  );
  assert.equal(tabelog?.value, 'Unknown');
  assert.equal(tabelog?.evidence, 'No durable evidence');
  assert.equal(reservation?.value, 'Unknown');
  assert.equal(reservation?.evidence, 'No durable evidence');
});

test('Feature 007 dedicated CSS protects focus, touch size, and 390px overflow', async () => {
  const [panel, styles] = await Promise.all([
    readFile(new URL('./catalog-intake-panel.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./catalog-intake-panel.css', import.meta.url), 'utf8'),
  ]);

  assert.match(panel, /import '\.\/catalog-intake-panel\.css';/u);
  assert.match(
    styles,
    /\.catalog-intake-corrections > summary[\s\S]*min-height: 2\.75rem/u,
  );
  assert.match(styles, /:focus-visible/u);
  assert.match(styles, /@media \(max-width: 480px\)/u);
  assert.match(
    styles,
    /\.catalog-intake-candidates > div[\s\S]*grid-template-columns: minmax\(0, 1fr\)/u,
  );
  assert.match(styles, /overflow-wrap: anywhere/u);
  assert.doesNotMatch(styles, /gradient|transition/u);
  assert.match(styles, /prefers-reduced-motion: reduce/u);
  assert.equal(
    (styles.match(/@keyframes/gu) ?? []).length,
    1,
    'only the research spinner animates',
  );
  assert.doesNotMatch(styles, /#[0-9a-f]{3,8}|(?:rgb|hsl|oklch)\(/iu);
});

test('Feature 007 keeps pending primary actions visible, disabled, and announced', async () => {
  const panel = await readFile(
    new URL('./catalog-intake-panel.tsx', import.meta.url),
    'utf8',
  );

  assert.match(panel, /catalogIntakeLiveMessage\(state\)/u);
  assert.match(panel, /aria-live="polite"/u);
  assert.match(panel, /aria-atomic="true"/u);
  assert.match(panel, /selectInProgress/u);
  assert.match(panel, /busy=\{selectInProgress\}/u);
  assert.match(panel, /busy[\s\S]*\? catalogIntakePendingMessage\('select'\)/u);
  assert.match(
    panel,
    /disabled=\{busy \|\| state\.selectedOrdinal === undefined\}/u,
  );
  assert.match(
    panel,
    /state\.lastOperation === 'discover'[\s\S]*\? catalogIntakePendingMessage\('discover'\)[\s\S]*: 'Find matches'/u,
  );
});

test('Feature 007 moves response focus to the stage or actionable retry control', async () => {
  const panel = await readFile(
    new URL('./catalog-intake-panel.tsx', import.meta.url),
    'utf8',
  );

  assert.match(panel, /const retryRef = useRef<HTMLButtonElement>\(null\)/u);
  assert.match(
    panel,
    /state\.stage === 'error'[\s\S]*retryRef\.current\?\.focus\(\)/u,
  );
  assert.match(panel, /stageHeadingRef\.current\?\.focus\(\)/u);
  assert.match(panel, /ref=\{retryRef\}/u);
  assert.match(panel, /onClick=\{\(\) => queryRef\.current\?\.focus\(\)\}/u);
});

function unknownPreview() {
  return {
    sessionId: 'session-feature-007',
    previewVersion: 2,
    state: 'preview_ready',
    candidateIdentity: {
      providerNamespace: 'google_places',
      placeId: 'place-feature-007',
    },
    ownerFields: {},
    titleProposal: {
      provenance: 'owner_query',
      value: '讃岐うどん大使 東京麺通団',
    },
    locationEvidence: { status: 'unknown' },
    tabelog: { status: 'unknown' },
    reservation: { status: 'unknown' },
    suspectedDuplicates: [],
    unknownFields: ['address', 'coordinates', 'tabelog', 'reservation'],
    warnings: [
      {
        code: 'durable_location_needs_review',
        message: 'Location still needs Owner review.',
      },
    ],
    evidenceDigest: 'a'.repeat(64),
    catalogRevision: 'catalog-feature-007',
    expiresAt: '2026-09-24T12:30:00.000Z',
  };
}
