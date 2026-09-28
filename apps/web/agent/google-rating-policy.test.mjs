import assert from 'node:assert/strict';
import test from 'node:test';

import { ratingPlaceId } from './google-rating-policy.ts';

const identity = {
  providerNamespace: 'google-places',
  placeId: 'ChIJ1234567890',
};
const item = (address, tabelog, candidateIdentity = identity) => ({
  kind: 'food',
  address,
  ...(tabelog ? { tabelog: { score: 3.4 } } : {}),
  intakeEvidence: { candidateIdentity },
});

test('Google rating uses a saved place ID overseas and only fills Japan without Tabelog', () => {
  assert.equal(
    ratingPlaceId(item('7 Dempsey Road, Singapore', false)),
    identity.placeId,
  );
  assert.equal(ratingPlaceId(item('青森県青森市古川1-13-12', true)), undefined);
  assert.equal(ratingPlaceId(item('Tokyo, Japan', false)), identity.placeId);
  assert.equal(ratingPlaceId(item('中国浙江省杭州市', false)), undefined);
  assert.equal(
    ratingPlaceId(item('Hong Kong, China', false)),
    identity.placeId,
  );
  assert.equal(
    ratingPlaceId(
      item('Singapore', false, {
        providerNamespace: 'tabelog',
        placeId: '1234567890',
      }),
    ),
    undefined,
  );
  assert.equal(
    ratingPlaceId(item('Singapore', false, { ...identity, placeId: 'bad/id' })),
    undefined,
  );
});
