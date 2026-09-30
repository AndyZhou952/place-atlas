import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeRecommendFoodTerm,
  normalizeRecommendIntent,
} from './recommend-intent.ts';

const options = [
  { id: 'area:central', kind: 'area', names: ['中央'] },
  {
    id: 'station:central',
    kind: 'station',
    names: ['中央駅', 'Central Station'],
  },
  { id: 'place:cafe-east', kind: 'place', names: ['喫茶 木陰 東口店'] },
  { id: 'place:cafe-west', kind: 'place', names: ['喫茶 木陰 西口店'] },
];

test('normalization applies default preference, cuisine aliases and a precise-origin question', () => {
  const result = normalizeRecommendIntent(
    ['中央で歩いて10分以内の烧鸟'],
    options,
    {
      action: 'recommend',
      originId: 'area:central',
      foodTerms: ['烧鸟', '焼鳥', 'yakitori'],
      travelMode: 'walk',
      maxMinutes: 10,
      visited: 'any',
    },
  );
  assert.equal(result.action, 'clarify');
  assert.equal(result.clarification, 'exact_origin');
  assert.deepEqual(result.foodTerms, ['yakitori']);
  assert.equal(result.visited, 'prefer_unvisited');
});

test('a branch answer preserves the original query and selects the model-supported saved origin', () => {
  const result = normalizeRecommendIntent(
    ['喫茶 木陰', 'Which branch?', '東口店'],
    options,
    { action: 'recommend', originId: 'place:cafe-east', foodTerms: [] },
  );
  assert.equal(result.action, 'recommend');
  assert.equal(result.originId, 'place:cafe-east');
});

test('a timed request without mode asks for it and an untrusted URL fails closed', () => {
  const timed = normalizeRecommendIntent(
    ['中央駅から15分以内のカレー'],
    options,
    { action: 'recommend', travelMode: 'walk', foodTerms: ['カレー'] },
  );
  assert.equal(timed.action, 'clarify');
  assert.equal(timed.clarification, 'travel_mode');
  assert.equal(timed.travelMode, 'none');
  const unsafe = normalizeRecommendIntent(
    ['https://google-maps.example.invalid/maps/place/中央駅'],
    options,
    { action: 'recommend', originId: 'station:central' },
  );
  assert.equal(unsafe.action, 'unsupported');
  assert.equal(unsafe.originId, null);
});

test('user-facing clarification text and codes cannot be supplied by the model', () => {
  const result = normalizeRecommendIntent(['recommend somewhere'], options, {
    action: 'clarify',
    clarification: 'invented_kind',
    question: 'Try an unsaved restaurant instead.',
    foodTerms: [],
  });
  assert.equal(result.action, 'clarify');
  assert.equal(result.clarification, 'origin');
  assert.equal(result.question, 'What starting point should I use?');
});

test('cafe catalog tags remain eligible for an explicit coffee or cafe request', () => {
  assert.equal(normalizeRecommendFoodTerm('カフェ'), 'coffee');
  assert.equal(normalizeRecommendFoodTerm('喫茶店'), 'coffee');
  assert.equal(normalizeRecommendFoodTerm('café'), 'coffee');
  const result = normalizeRecommendIntent(
    ['中央駅から電車20分以内のカフェ'],
    options,
    {
      action: 'recommend',
      originId: 'station:central',
      foodTerms: ['coffee'],
      travelMode: 'transit',
      maxMinutes: 20,
    },
  );
  assert.equal(result.action, 'recommend');
  assert.deepEqual(result.foodTerms, ['coffee']);
  const unrelated = normalizeRecommendIntent(
    ['中央駅から電車20分以内の寿司'],
    options,
    {
      action: 'recommend',
      originId: 'station:central',
      foodTerms: ['coffee', 'sushi'],
      travelMode: 'transit',
      maxMinutes: 20,
    },
  );
  assert.deepEqual(unrelated.foodTerms, ['sushi']);
});

test('an explicit train request near me keeps the train constraint', () => {
  const result = normalizeRecommendIntent(
    ['Central Stationから電車20分以内でnear meのカレー'],
    options,
    {
      action: 'recommend',
      originId: 'station:central',
      foodTerms: ['curry'],
      travelMode: 'transit',
      maxMinutes: 20,
    },
  );
  assert.equal(result.travelMode, 'transit');
  assert.equal(result.maxMinutes, 20);
  const withoutNumber = normalizeRecommendIntent(
    ['Central Stationから電車でnear meのカレー'],
    options,
    {
      action: 'recommend',
      originId: 'station:central',
      foodTerms: ['curry'],
      travelMode: 'transit',
    },
  );
  assert.equal(withoutNumber.travelMode, 'transit');
  assert.equal(withoutNumber.maxMinutes, 20);
  const unqualified = normalizeRecommendIntent(
    ['Good curry near me'],
    options,
    {
      action: 'recommend',
      foodTerms: ['curry'],
      travelMode: 'transit',
    },
  );
  assert.equal(unqualified.action, 'clarify');
  assert.equal(unqualified.clarification, 'origin');
  assert.equal(unqualified.travelMode, 'none');
  assert.equal(unqualified.maxMinutes, null);
});

test('walking in a stated number of minutes remains a timed route request', () => {
  const result = normalizeRecommendIntent(
    ['Find coffee I can walk in 10 minutes from Central Station'],
    options,
    {
      action: 'recommend',
      originId: 'station:central',
      foodTerms: ['coffee'],
      travelMode: 'none',
    },
  );
  assert.equal(result.action, 'recommend');
  assert.equal(result.travelMode, 'walk');
  assert.equal(result.maxMinutes, 10);
});
