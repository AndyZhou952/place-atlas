import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyRestaurant,
  subdivisionDisplayName,
  isRestaurantClassification,
  withRestaurantClassification,
} from './restaurant-classification.ts';
const classify = (tags, address = '') =>
  classifyRestaurant({ kind: 'food', tags, address });

test('aliases collapse to canonical categories and different cuisines remain distinct', () => {
  assert.deepEqual(classify(['焼き鳥', '鳥料理', '串焼き', '寿司']).cuisines, [
    { familyId: 'japanese', categoryId: 'japanese.sushi' },
    { familyId: 'japanese', categoryId: 'japanese.yakitori' },
  ]);
  assert.deepEqual(classify(['四川料理', '点心']).cuisines, [
    { familyId: 'chinese', categoryId: 'chinese.dim-sum' },
    { familyId: 'chinese', categoryId: 'chinese.sichuan' },
  ]);
});

test('location and name do not imply cuisine and unsupported labels remain unknown', () => {
  assert.deepEqual(
    classify(['Chef special'], '東京都渋谷区1-2-3').cuisines,
    [],
  );
  assert.deepEqual(classify(['カフェ'], '東京都港区1-2-3').cuisines, [
    { familyId: 'cafe-dessert', categoryId: 'cafe-dessert.cafe' },
  ]);
  assert.deepEqual(classify(['カレー']).cuisines, [
    { familyId: 'international', categoryId: 'international.curry' },
  ]);
  assert.deepEqual(
    classifyRestaurant({
      kind: 'food',
      title: 'Tokyo sushi',
      tags: [],
      address: '',
    }).geography,
    {},
  );
});

test('saved category evidence takes precedence over dish tags without modifying either', () => {
  const input = {
    kind: 'food',
    tags: ['ラーメン', 'cake'],
    address: '青森県青森市1-2',
    intakeEvidence: {
      ownerFields: { categories: ['イタリアン'] },
      profile: { categories: { value: ['寿司'] } },
    },
  };
  assert.deepEqual(classifyRestaurant(input).cuisines, [
    { familyId: 'italian' },
  ]);
  assert.deepEqual(input.tags, ['ラーメン', 'cake']);
});

test('administrative names in addresses yield ISO country and subdivision codes', () => {
  for (const [address, code, name] of [
    ['東京都港区六本木1-2-3', 'JP-13', '東京都'],
    ['大阪府大阪市中央区1-2', 'JP-27', '大阪府'],
    ['中国上海市黄浦区1-2', 'CN-SH', '上海市'],
    ['四川省成都市1-2', 'CN-SC', '四川省'],
    ['1 Market St, San Francisco, CA 94105, USA', 'US-CA', 'California'],
  ])
    assert.deepEqual(classify([], address).geography, {
      countryCode: code.slice(0, 2),
      subdivisionCode: code,
      subdivisionName: name,
    });
});

test('missing or conflicting address evidence never uses coordinates or city guesses', () => {
  assert.deepEqual(classify([], '新宿3-14-22').geography, {});
  assert.deepEqual(classify([], '10 Road, Thailand').geography, {
    countryCode: 'TH',
  });
  assert.deepEqual(classify([], '東京都渋谷区, Osaka, Japan').geography, {
    countryCode: 'JP',
  });
  assert.deepEqual(classify([], '東京都港区, China').geography, {});
});

test('schema checks hierarchy, subdivision identity and duplicate categories', () => {
  const valid = classify(['寿司'], '東京都港区1-2-3');
  assert.equal(isRestaurantClassification(valid), true);
  assert.equal(
    isRestaurantClassification({
      ...valid,
      cuisines: [{ familyId: 'chinese', categoryId: 'japanese.sushi' }],
    }),
    false,
  );
  assert.equal(
    isRestaurantClassification({
      ...valid,
      cuisines: [...valid.cuisines, ...valid.cuisines],
    }),
    false,
  );
  assert.equal(
    isRestaurantClassification({
      ...valid,
      geography: {
        countryCode: 'CN',
        subdivisionCode: 'JP-13',
        subdivisionName: '東京都',
      },
    }),
    false,
  );
  assert.equal(
    isRestaurantClassification({
      ...valid,
      geography: {
        countryCode: 'JP',
        subdivisionCode: 'JP-13',
        subdivisionName: 'Osaka',
      },
    }),
    false,
  );
  assert.equal(
    isRestaurantClassification({
      ...valid,
      geography: { subdivisionName: 'Unknown' },
    }),
    false,
  );
});

test('classification recomputes when saved category and address change', () => {
  const old = {
    kind: 'food',
    tags: ['寿司'],
    address: '東京都港区1-2',
    classification: classify(['寿司'], '東京都港区1-2'),
  };
  const changed = withRestaurantClassification({
    ...old,
    tags: ['ラーメン'],
    address: '大阪府大阪市1-2',
  });
  assert.equal(changed.classification.cuisines[0].categoryId, 'japanese.ramen');
  assert.equal(changed.classification.geography.subdivisionCode, 'JP-27');
});

test('international countries are recognized from explicit country address components and US street names are not states', () => {
  assert.deepEqual(
    classify([], '1 Main Road, Melbourne, Australia').geography,
    { countryCode: 'AU' },
  );
  assert.deepEqual(
    classify([], '1 Washington Avenue, Toronto, Canada').geography,
    { countryCode: 'CA' },
  );
  assert.deepEqual(classify([], '10 Road, Tbilisi, Georgia').geography, {
    countryCode: 'GE',
  });
  assert.deepEqual(
    classify([], '1 Road, Los Angeles, California 90001, USA').geography,
    {
      countryCode: 'US',
      subdivisionCode: 'US-CA',
      subdivisionName: 'California',
    },
  );
  assert.equal(
    isRestaurantClassification({
      ...classify([]),
      geography: { countryCode: 'ZZ' },
    }),
    false,
  );
});

test('explicit English Chinese province names and US states preserve separate cuisine and geography', () => {
  assert.deepEqual(
    classify(['泰国菜'], '1 Street, Chengdu, Sichuan, China').geography,
    { countryCode: 'CN', subdivisionCode: 'CN-SC', subdivisionName: '四川省' },
  );
  assert.deepEqual(classify(['牛タン']).cuisines, [
    { familyId: 'international', categoryId: 'international.beef' },
  ]);
  assert.deepEqual(classify(['american steak']).cuisines, [
    { familyId: 'american', categoryId: 'american.steak' },
  ]);
});

test('an Owner review candidate keeps known address geography when coordinates remain unknown', () => {
  const classification = classifyRestaurant({
    kind: 'food',
    tags: [],
    reviewEvidence: {
      ownerFields: { categories: ['寿司'] },
      addressProposal: { value: '大阪府大阪市中央区1-2-3' },
    },
  });
  assert.equal(classification.geography.subdivisionCode, 'JP-27');
  assert.equal(classification.cuisines[0].categoryId, 'japanese.sushi');
});

test('English subdivision display preserves native stored names and matching evidence', () => {
  const classification = classify([], '東京都港区1-2-3');
  assert.equal(
    subdivisionDisplayName('JP-13', classification.geography.subdivisionName),
    'Tokyo',
  );
  assert.equal(subdivisionDisplayName('CN-SC', '四川省'), 'Sichuan');
  assert.equal(subdivisionDisplayName('US-CA', 'California'), 'California');
  assert.equal(
    subdivisionDisplayName('unknown', 'Original name'),
    'Original name',
  );
  assert.equal(classification.geography.subdivisionName, '東京都');
  assert.equal(isRestaurantClassification(classification), true);
});
