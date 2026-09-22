import assert from 'node:assert/strict';
import test from 'node:test';

import { createGooglePlaceDiscoveryAdapter } from './google-place-discovery.ts';

test('Google transient discovery passes through three-language queries and returns stable Top-3 identities', async () => {
  const queries = [];
  const client = {
    async searchText({ query }) {
      queries.push(query);
      return {
        ok: true,
        value: {
          places: [
            place('place-z', 0.8),
            place('place-b', 0.9),
            place('place-a', 0.9),
            place('place-c', 0.7),
          ],
          hasMore: false,
        },
      };
    },
    async getPlace({ placeId }) {
      return { ok: true, value: place(placeId, 1) };
    },
  };
  const adapter = createGooglePlaceDiscoveryAdapter(client);

  for (const query of ['銀座 鮨', '银座 寿司', 'Ginza sushi']) {
    const result = await adapter.discover({ query });
    assert.equal(result.ok, true);
    assert.deepEqual(
      result.value.candidates.map(({ durableIdentity }) => durableIdentity),
      [
        {
          providerNamespace: 'google-places',
          placeId: 'place-a',
          ordinal: 1,
        },
        {
          providerNamespace: 'google-places',
          placeId: 'place-b',
          ordinal: 2,
        },
        {
          providerNamespace: 'google-places',
          placeId: 'place-z',
          ordinal: 3,
        },
      ],
    );
    assert.equal(result.value.hasMore, true);
  }
  assert.deepEqual(queries, ['銀座 鮨', '银座 寿司', 'Ginza sushi']);
});

test('Google transient refetch returns one attributed request-scoped presentation', async () => {
  const adapter = createGooglePlaceDiscoveryAdapter({
    async searchText() {
      throw new Error('not used');
    },
    async getPlace({ placeId }) {
      return { ok: true, value: place(placeId, 1) };
    },
  });

  const result = await adapter.refetch({
    providerNamespace: 'google-places',
    placeId: 'place-a',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    durableIdentity: {
      providerNamespace: 'google-places',
      placeId: 'place-a',
      ordinal: 1,
    },
    transientPresentation: {
      name: 'Name place-a',
      address: 'Address place-a',
      attribution: {
        label: 'Google Maps',
        url: 'https://maps.google.com/',
      },
    },
  });
});

test('Google discovery fails closed for malformed or duplicate transient provider data', async () => {
  for (const places of [
    [place(' ', 1)],
    [place('place-a', 1), place('place-a', 0.5)],
    [place('place-a', Number.NaN)],
    [place('place-a', Number.POSITIVE_INFINITY)],
    [{ ...place('place-a', 1), name: ' ' }],
    [{ ...place('place-a', 1), address: 'Address\u0085private' }],
  ]) {
    const adapter = createGooglePlaceDiscoveryAdapter({
      async searchText() {
        return { ok: true, value: { places, hasMore: false } };
      },
      async getPlace() {
        throw new Error('not used');
      },
    });

    const result = await adapter.discover({ query: '銀座 鮨' });
    assert.equal(result.ok, false);
    assert.equal(result.error.kind, 'dependency_failure');
  }
});

test('Google refetch fails closed for a malformed or mismatched provider identity', async () => {
  for (const returned of [place(' ', 1), place('different-place', 1)]) {
    const adapter = createGooglePlaceDiscoveryAdapter({
      async searchText() {
        throw new Error('not used');
      },
      async getPlace() {
        return { ok: true, value: returned };
      },
    });

    const result = await adapter.refetch({
      providerNamespace: 'google-places',
      placeId: 'place-a',
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.kind, 'dependency_failure');
  }
});

function place(placeId, relevance) {
  return {
    placeId,
    relevance,
    name: `Name ${placeId}`,
    address: `Address ${placeId}`,
  };
}
