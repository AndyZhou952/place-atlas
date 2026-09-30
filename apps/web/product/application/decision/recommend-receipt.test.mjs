import assert from 'node:assert/strict';
import test from 'node:test';

import { materializeRecommendReceipt } from './recommend-receipt.ts';

const item = (overrides = {}) => ({
  id: 'saved-a',
  kind: 'food',
  verificationStatus: 'verified',
  title: 'Stored canonical name',
  area: 'Tokyo',
  address: 'Stored address',
  latitude: 35.6,
  longitude: 139.7,
  tags: ['sushi'],
  hasVisited: false,
  ...overrides,
});
const suggestion = (overrides = {}) => ({
  itemId: 'saved-a',
  detailTargetId: 'saved-a',
  reason: 'Saved sushi in Tokyo.',
  reasonFacts: [{ kind: 'saved', value: true }],
  ...overrides,
});
const receipt = (candidate, current = item(), routes = new Map()) =>
  materializeRecommendReceipt([candidate], [item()], [current], routes, []);

test('receipt uses the exact database title even if a model supplies a different name', () => {
  const result = receipt(suggestion({ name: 'Invented Restaurant' }));
  assert.equal(result?.[0].name, 'Stored canonical name');
  assert.equal(result?.[0].detailTargetId, result?.[0].itemId);
});

test('receipt rejects unknown, deleted, unverified and mismatched detail IDs', () => {
  assert.equal(receipt(suggestion({ itemId: 'invented' })), undefined);
  assert.equal(
    materializeRecommendReceipt([suggestion()], [item()], [], new Map(), []),
    undefined,
  );
  assert.equal(
    receipt(suggestion(), item({ verificationStatus: 'pending' })),
    undefined,
  );
  assert.equal(receipt(suggestion({ detailTargetId: 'other' })), undefined);
});

test('receipt fails closed when the selected record or route evidence changes', () => {
  assert.equal(receipt(suggestion(), item({ tags: ['ramen'] })), undefined);
  assert.equal(
    receipt(suggestion(), item({ title: 'Changed identity' })),
    undefined,
  );
  assert.equal(receipt(suggestion(), item({ hasVisited: true })), undefined);
  assert.equal(receipt(suggestion(), item({ latitude: 36 })), undefined);
  const routeClaim = { mode: 'walk', seconds: 600 };
  assert.equal(receipt(suggestion({ routeClaim })), undefined);
  assert.equal(
    receipt(
      suggestion({ routeClaim }),
      item(),
      new Map([
        [
          'saved-a:walk',
          {
            seconds: 700,
            checkedAt: '2026-09-30T00:00:00.000Z',
            source: { label: 'Maps', url: 'https://maps.example/' },
          },
        ],
      ]),
    ),
    undefined,
  );
});
