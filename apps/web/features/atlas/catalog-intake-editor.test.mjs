import assert from 'node:assert/strict';
import test from 'node:test';
import {
  catalogIntakeEditorValues,
  catalogIntakeSelectionDetails,
} from './catalog-intake-editor.ts';
import {
  catalogIntakeInitialState,
  reduceCatalogIntakeUi,
} from './catalog-intake-ui-state.ts';

function preview() {
  return {
    ownerFields: {},
    titleProposal: { value: 'Test restaurant' },
    addressProposal: { value: 'Tokyo address' },
    profile: {
      area: { value: 'Shinjuku' },
      categories: { value: ['ラーメン'] },
      signatureDishes: { value: ['塩ラーメン'] },
      summary: { value: '主营拉面。' },
    },
    locationEvidence: { status: 'known', latitude: 35.68, longitude: 139.7 },
    tabelog: {
      status: 'known',
      score: 3.6,
      url: 'https://tabelog.com/tokyo/A1304/A130401/12345678/',
    },
    reservation: {
      status: 'known',
      mode: 'not_reservable',
      label: '予約不可',
      url: 'https://example.com/booking',
    },
  };
}
function state() {
  const p = preview();
  return {
    ...catalogIntakeInitialState(),
    ...catalogIntakeEditorValues(p),
    stage: 'preview',
    preview: p,
  };
}

test('inline editor starts from researched values without promoting them to Owner assertions', () => {
  const s = state();
  assert.equal(s.title, 'Test restaurant');
  assert.equal(s.categories, 'ラーメン');
  assert.equal(s.tabelogScore, '3.6');
  assert.deepEqual(catalogIntakeSelectionDetails(s), { ownerFields: {} });
  assert.deepEqual(
    catalogIntakeSelectionDetails({ ...s, title: 'Corrected restaurant' }),
    { ownerFields: { title: 'Corrected restaurant' } },
  );
});

test('refresh retains prior Owner overrides but does not copy unrelated researched fields', () => {
  const s = state();
  s.preview.ownerFields = { summary: 'Owner overview', categories: ['カレー'] };
  Object.assign(s, catalogIntakeEditorValues(s.preview));
  s.title = 'New name';
  assert.deepEqual(catalogIntakeSelectionDetails(s), {
    ownerFields: {
      title: 'New name',
      summary: 'Owner overview',
      categories: ['カレー'],
    },
  });
});

test('editing an address invalidates the old coordinates and uses lookup unless a new point is supplied', () => {
  let s = reduceCatalogIntakeUi(state(), {
    type: 'field_changed',
    field: 'address',
    value: 'Different address',
  });
  assert.equal(s.latitude, '');
  assert.equal(s.longitude, '');
  assert.equal(s.previewNeedsRefresh, true);
  assert.deepEqual(catalogIntakeSelectionDetails(s), {
    ownerFields: { address: 'Different address' },
  });
  s = { ...s, latitude: '36', longitude: '140' };
  assert.deepEqual(catalogIntakeSelectionDetails(s).ownerFields.coordinates, {
    latitude: 36,
    longitude: 140,
  });
});

test('source-backed edits are explicit and clearing a rating sends unknown', () => {
  const s = state();
  assert.equal(
    catalogIntakeSelectionDetails({ ...s, tabelogScore: '', tabelogUrl: '' })
      .tabelog,
    'unknown',
  );
  assert.deepEqual(
    catalogIntakeSelectionDetails({ ...s, tabelogScore: '3.8' }).tabelog,
    { score: 3.8, url: s.tabelogUrl },
  );
});

test('schedule edits keep value and citation together without promoting unchanged research', () => {
  const p = preview();
  p.profile.openingHours = {
    value: '月〜金 11:30 - 14:30 / 17:00 - 22:00',
    sourceUrl: p.tabelog.url,
  };
  const s = {
    ...catalogIntakeInitialState(),
    ...catalogIntakeEditorValues(p),
    preview: p,
  };
  assert.deepEqual(catalogIntakeSelectionDetails(s), { ownerFields: {} });
  const edited = {
    ...s,
    openingHours: '月〜金 11:30 - 14:00 / 17:00 - 22:00',
    regularClosingDays: '水曜日',
    regularClosingDaysSourceUrl: p.tabelog.url,
  };
  const details = catalogIntakeSelectionDetails(edited);
  assert.deepEqual(details.ownerFields.openingHours, {
    value: edited.openingHours,
    sourceUrl: p.tabelog.url,
  });
  assert.deepEqual(details.ownerFields.regularClosingDays, {
    value: '水曜日',
    sourceUrl: p.tabelog.url,
  });
  p.ownerFields = details.ownerFields;
  assert.equal(catalogIntakeEditorValues(p).openingHours, edited.openingHours);
});

test('restart after a failed request preserves manual schedule text and citations', () => {
  const edited = {
    ...state(),
    stage: 'error',
    openingHours: 'Lunch 11:00 - 14:00',
    openingHoursSourceUrl: 'https://restaurant.example/hours',
    regularClosingDays: 'Monday',
    regularClosingDaysSourceUrl: 'https://restaurant.example/hours',
  };
  const restarted = reduceCatalogIntakeUi(edited, { type: 'restart' });
  for (const field of [
    'openingHours',
    'openingHoursSourceUrl',
    'regularClosingDays',
    'regularClosingDaysSourceUrl',
  ])
    assert.equal(restarted[field], edited[field]);
});
