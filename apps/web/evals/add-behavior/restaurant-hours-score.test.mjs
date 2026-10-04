import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { scoreRestaurantHours } from './restaurant-hours-score.mjs';
const { cases } = JSON.parse(
  readFileSync(new URL('./restaurant-hours.v1.json', import.meta.url), 'utf8'),
);
test('both curated schedules pass and missing hours fail', () => {
  for (const sample of cases) {
    assert.equal(scoreRestaurantHours(sample, sample).pass, true);
    assert.equal(scoreRestaurantHours(sample, undefined).pass, false);
  }
});
test('a wrong dinner close, wrong source branch or invented weekly closure fails', () => {
  const sample = cases[0];
  assert.equal(
    scoreRestaurantHours(sample, {
      openingHours: {
        ...sample.openingHours,
        value: sample.openingHours.value.replaceAll('23:00', '22:00'),
      },
    }).pass,
    false,
  );
  assert.equal(
    scoreRestaurantHours(sample, {
      openingHours: {
        ...sample.openingHours,
        sourceUrl: 'https://gf-restaurant.jp/rodeo/shibuya',
      },
    }).pass,
    false,
  );
  assert.equal(
    scoreRestaurantHours(sample, {
      openingHours: sample.openingHours,
      regularClosingDays: { value: '月曜' },
    }).pass,
    false,
  );
});
test('day labels remain required and weekday spelling may normalize without changing meaning', () => {
  const sample = cases[1];
  assert.equal(
    scoreRestaurantHours(sample, {
      openingHours: sample.openingHours,
      regularClosingDays: {
        ...sample.regularClosingDays,
        value: '土・日・祝日',
      },
    }).pass,
    true,
  );
  assert.equal(
    scoreRestaurantHours(sample, {
      openingHours: { ...sample.openingHours, value: '08:15 - 14:30' },
      regularClosingDays: sample.regularClosingDays,
    }).pass,
    false,
  );
});

test('the same times assigned to the wrong days or missing midweek days fail', () => {
  const rodeo = cases[0];
  assert.equal(
    scoreRestaurantHours(rodeo, {
      openingHours: {
        ...rodeo.openingHours,
        value: '土・日・祝 17:00 - 23:00; 月〜金 12:00 - 14:00 17:00 - 23:00',
      },
    }).pass,
    false,
  );
  const shima = cases[1];
  assert.equal(
    scoreRestaurantHours(shima, {
      openingHours: {
        ...shima.openingHours,
        value: '月・金 08:15 - 14:30; 土・日・祝日 定休日',
      },
      regularClosingDays: shima.regularClosingDays,
    }).pass,
    false,
  );
});
