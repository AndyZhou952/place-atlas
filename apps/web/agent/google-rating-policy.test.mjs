import assert from 'node:assert/strict';
import test from 'node:test';

import { previewRatingPlaceId, ratingPlaceId } from './google-rating-policy.ts';

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

test('preview Google rating uses only a current selected Place ID and respects regional policy', () => {
  const previewSession = (query, address, tabelogStatus = 'unknown') => ({
    state: 'preview_ready',
    ownerQuery: query,
    preview: {
      expiresAt: '2026-10-01T00:00:00.000Z',
      candidateIdentity: identity,
      ownerFields: { address },
      tabelog: { status: tabelogStatus },
    },
  });
  const now = new Date('2026-09-28T00:00:00.000Z');
  assert.equal(
    previewRatingPlaceId(previewSession('Burnt Ends Singapore', ''), now),
    identity.placeId,
  );
  assert.equal(
    previewRatingPlaceId(
      previewSession('Verve Coffee 六本木', 'Tokyo, Japan'),
      now,
    ),
    identity.placeId,
  );
  assert.equal(
    previewRatingPlaceId(
      previewSession('青森 海坊厨', '青森県青森市', 'known'),
      now,
    ),
    undefined,
  );
  assert.equal(
    previewRatingPlaceId(previewSession('海底捞 上海', '上海市'), now),
    undefined,
  );
  assert.equal(
    previewRatingPlaceId(previewSession('Hong Kong, China', ''), now),
    identity.placeId,
  );
  assert.equal(
    previewRatingPlaceId(
      {
        ...previewSession('Burnt Ends Singapore', ''),
        preview: {
          ...previewSession('Burnt Ends Singapore', '').preview,
          expiresAt: '2026-09-27T00:00:00.000Z',
        },
      },
      now,
    ),
    undefined,
  );
  assert.equal(
    previewRatingPlaceId(
      {
        ...previewSession('Burnt Ends Singapore', ''),
        preview: {
          ...previewSession('Burnt Ends Singapore', '').preview,
          candidateIdentity: { ...identity, placeId: 'another/id' },
        },
      },
      now,
    ),
    undefined,
  );
});

test('saved Google rating is independent from Tabelog and excludes mainland China', () => {
  assert.equal(
    ratingPlaceId(item('7 Dempsey Road, Singapore', false)),
    identity.placeId,
  );
  assert.equal(
    ratingPlaceId(item('青森県青森市古川1-13-12', true)),
    identity.placeId,
  );
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
