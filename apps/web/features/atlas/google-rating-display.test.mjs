import { verifiedAtlasItems } from './verified-items.ts';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  googleRatingIdentity,
  parseGoogleRating,
  withDisplayedGoogleRatings,
} from './google-rating-display.ts';
import { catalogTableRows, emptyTableFilters } from './catalog-table-policy.ts';

const item = (id, address = 'Tokyo, Japan') => ({
  id,
  title: id,
  address,
  kind: 'food',
  verificationStatus: 'verified',
  intakeEvidence: {
    candidateIdentity: {
      providerNamespace: 'google-places',
      placeId: `ChIJ${id}1234567890`,
    },
  },
});
const rating = (score) =>
  parseGoogleRating(
    { score, reviewCount: 123, url: 'https://maps.google.com/?cid=123' },
    '2026-10-02T00:00:00Z',
  );
test('Map display scores feed Table sorting without mutating catalog or personal scores', () => {
  const a = { ...item('a'), personalRating: 2, tabelog: { score: 3.6 } };
  const b = item('b');
  const c = item('c');
  const source = [a, b, c];
  const displayed = withDisplayedGoogleRatings(source, {
    a: {
      identity: googleRatingIdentity(a),
      status: 'loaded',
      rating: rating(4.2),
    },
    b: {
      identity: googleRatingIdentity(b),
      status: 'loaded',
      rating: rating(4.8),
    },
  });
  assert.equal(displayed[0].googleRating.score, 4.2);
  assert.equal(displayed[0].personalRating, 2);
  assert.equal(displayed[0].tabelog.score, 3.6);
  assert.equal(a.googleRating, undefined);
  assert.deepEqual(
    catalogTableRows(displayed, [], emptyTableFilters, 'google', false).map(
      (r) => r.item.id,
    ),
    ['b', 'a', 'c'],
  );
  assert.deepEqual(
    catalogTableRows(displayed, [], emptyTableFilters, 'google', true).map(
      (r) => r.item.id,
    ),
    ['a', 'b', 'c'],
  );
});
test('scores do not cross restaurant identity changes and disappear when display state clears', () => {
  const a = item('a');
  const display = {
    a: {
      identity: googleRatingIdentity(a),
      status: 'loaded',
      rating: rating(4.2),
    },
  };
  assert.equal(
    withDisplayedGoogleRatings([{ ...a, address: 'Singapore' }], display)[0]
      .googleRating,
    undefined,
  );
  assert.equal(withDisplayedGoogleRatings([a], {})[0].googleRating, undefined);
});
test('mainland China never displays a Google rating', () => {
  const a = { ...item('a', '中国上海市'), googleRating: rating(4) };
  assert.equal(
    withDisplayedGoogleRatings([a], {
      a: {
        identity: googleRatingIdentity(a),
        status: 'loaded',
        rating: rating(5),
      },
    })[0].googleRating,
    undefined,
  );
});
test('rating response validates scale, count and Google attribution URL', () => {
  for (const value of [
    { score: 6, url: 'https://maps.google.com' },
    { score: NaN, url: 'https://maps.google.com' },
    { score: 4, reviewCount: -1, url: 'https://maps.google.com' },
    { score: 4, url: 'https://evil.test' },
    { score: 4, url: 'javascript:alert(1)' },
  ])
    assert.equal(parseGoogleRating(value, 'now'), undefined);
  assert.equal(rating(4).reviewCount, 123);
});

test('the full initial catalog renders without private references, including non-restaurants and missing Place IDs', () => {
  const displayed = withDisplayedGoogleRatings(verifiedAtlasItems, {});
  assert.equal(displayed.length, verifiedAtlasItems.length);
  for (const item of verifiedAtlasItems) {
    assert.equal(displayed.find((row) => row.id === item.id).title, item.title);
  }
  assert.doesNotThrow(() =>
    withDisplayedGoogleRatings(
      [
        {
          ...verifiedAtlasItems[0],
          kind: 'architecture',
          googlePlaceId: undefined,
          intakeEvidence: undefined,
        },
      ],
      {},
    ),
  );
});
