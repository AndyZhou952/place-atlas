import assert from 'node:assert/strict';
import test from 'node:test';

import {
  matchesAtlasQuery,
  searchCatalogRestaurantsByName,
} from '../../product/application/decision/search-policy.ts';

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

test('empty input lets the owner browse every verified restaurant', () => {
  const places = [
    place('海坊厨', { area: '青森', tags: ['海鮮'] }),
    place('青森 待审核', { verificationStatus: 'needs_review' }),
    place('青森 候补', { personalState: 'candidate' }),
    place('青森 祭り', { kind: 'event' }),
  ];
  assert.deepEqual(searchCatalogRestaurantsByName(places, ''), [
    places[0],
    places[2],
  ]);
  assert.deepEqual(searchCatalogRestaurantsByName(places, '青森'), [places[2]]);
  assert.deepEqual(searchCatalogRestaurantsByName(places, '海坊'), [places[0]]);
});

test('map search never treats missing catalog fields as a match', () => {
  const unrelated = {
    title: 'マクドナルド 池袋LABI前店',
    alternateTitle: '',
    area: '池袋',
    address: '',
    description: '',
    tags: [],
  };
  const shinjuku = {
    ...unrelated,
    title: 'シェイク シャック 新宿サザンテラス',
    area: '新宿',
  };
  assert.equal(matchesAtlasQuery(unrelated, '新宿'), false);
  assert.equal(matchesAtlasQuery(shinjuku, '新宿'), true);
  assert.equal(matchesAtlasQuery(unrelated, ''), true);
});

test('a verified restaurant remains selectable before its personal state is saved', () => {
  const restaurant = place('海坊厨', { personalState: 'candidate' });
  assert.deepEqual(searchCatalogRestaurantsByName([restaurant], '海坊'), [
    restaurant,
  ]);
});
