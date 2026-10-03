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
