import assert from 'node:assert/strict';
import test from 'node:test';

import { withSameListingFallback } from './tabelog-source-fallback.ts';

const listingUrl = 'https://tabelog.com/tokyo/A1304/A130401/13210432/';
const withoutGeo = {
  kind: 'read',
  evidence: {
    url: listingUrl,
    title: 'シェイクシャック 新宿サザンテラス',
    content: 'Restaurant facts',
    restaurant: { name: 'シェイクシャック 新宿サザンテラス', score: 3.4 },
  },
};
const withGeo = {
  kind: 'read',
  evidence: {
    ...withoutGeo.evidence,
    restaurant: {
      ...withoutGeo.evidence.restaurant,
      coordinates: { latitude: 35.686597, longitude: 139.700879 },
    },
  },
};

test('a complete first listing does not spend a second source read', async () => {
  let fallbacks = 0;
  const reader = withSameListingFallback(
    async () => withGeo,
    async () => {
      fallbacks += 1;
      return withoutGeo;
    },
  );
  assert.deepEqual(
    await reader(listingUrl, new AbortController().signal),
    withGeo,
  );
  assert.equal(fallbacks, 0);
});

test('the exact same listing can recover missing coordinates or a failed primary read', async () => {
  const calls = [];
  const fallback = async (url) => {
    calls.push(url);
    return withGeo;
  };
  for (const primary of [
    withoutGeo,
    { kind: 'unavailable' },
    { kind: 'blocked' },
  ]) {
    const reader = withSameListingFallback(async () => primary, fallback);
    assert.deepEqual(
      await reader(listingUrl, new AbortController().signal),
      withGeo,
    );
  }
  assert.deepEqual(calls, [listingUrl, listingUrl, listingUrl]);
});

test('a denied or less complete fallback cannot erase supported primary facts', async () => {
  const reader = withSameListingFallback(
    async () => withoutGeo,
    async () => ({ kind: 'blocked' }),
  );
  assert.deepEqual(
    await reader(listingUrl, new AbortController().signal),
    withoutGeo,
  );
  const blocked = withSameListingFallback(
    async () => ({ kind: 'blocked' }),
    async () => ({ kind: 'unavailable' }),
  );
  assert.deepEqual(await blocked(listingUrl, new AbortController().signal), {
    kind: 'blocked',
  });
});
