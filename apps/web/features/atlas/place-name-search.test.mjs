import assert from 'node:assert/strict';
import test from 'node:test';

import { searchSavedPlacesByName } from '../../product/application/decision/search-policy.ts';

const place = (title, extra = {}) => ({
  kind: 'food',
  title,
  verificationStatus: 'verified',
  personalState: 'saved',
  ...extra,
});

test('literal name search handles width, case and an alternate title', () => {
  const places = [
    place('シェイク シャック 新宿サザンテラス', {
      alternateTitle: 'SHAKE SHACK Shinjuku Southern Terrace',
    }),
    place('喫茶 月森'),
  ];
  assert.deepEqual(searchSavedPlacesByName(places, 'ＳＨＡＫＥ'), [places[0]]);
  assert.deepEqual(searchSavedPlacesByName(places, '月森'), [places[1]]);
  assert.deepEqual(searchSavedPlacesByName(places, '  shinjuku '), [places[0]]);
});

test('empty and non-name searches cannot expose a long or unsaved list', () => {
  const places = [
    place('海坊厨', { area: '青森', tags: ['海鮮'] }),
    place('青森 待审核', { verificationStatus: 'needs_review' }),
    place('青森 候补', { personalState: 'candidate' }),
    place('青森 祭り', { kind: 'event' }),
  ];
  assert.deepEqual(searchSavedPlacesByName(places, ''), []);
  assert.deepEqual(searchSavedPlacesByName(places, '青森'), []);
  assert.deepEqual(searchSavedPlacesByName(places, '海坊'), [places[0]]);
});
