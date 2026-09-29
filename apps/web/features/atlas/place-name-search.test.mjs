import assert from 'node:assert/strict';
import test from 'node:test';

import { searchCatalogRestaurantsByName } from '../../product/application/decision/search-policy.ts';

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
  assert.deepEqual(searchCatalogRestaurantsByName(places, 'ＳＨＡＫＥ'), [
    places[0],
  ]);
  assert.deepEqual(searchCatalogRestaurantsByName(places, '月森'), [places[1]]);
  assert.deepEqual(searchCatalogRestaurantsByName(places, '  shinjuku '), [
    places[0],
  ]);
});

test('empty and non-name searches do not expose the long list', () => {
  const places = [
    place('海坊厨', { area: '青森', tags: ['海鮮'] }),
    place('青森 待审核', { verificationStatus: 'needs_review' }),
    place('青森 候补', { personalState: 'candidate' }),
    place('青森 祭り', { kind: 'event' }),
  ];
  assert.deepEqual(searchCatalogRestaurantsByName(places, ''), []);
  assert.deepEqual(searchCatalogRestaurantsByName(places, '青森'), [places[2]]);
  assert.deepEqual(searchCatalogRestaurantsByName(places, '海坊'), [places[0]]);
});

test('a verified restaurant remains selectable before its personal state is saved', () => {
  const restaurant = place('海坊厨', { personalState: 'candidate' });
  assert.deepEqual(searchCatalogRestaurantsByName([restaurant], '海坊'), [
    restaurant,
  ]);
});
