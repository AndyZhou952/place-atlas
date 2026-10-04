import assert from 'node:assert/strict';
import test from 'node:test';

import { enrichFinalNearbyCandidatesWithEntryAccess } from './entry-access-nearby-decorator.ts';
const policy = {
  policyVersion: 'entry-v1',
  allowedSourceOrigins: ['https://example.test'],
  maximumAgeMs: 5 * 60 * 1000,
  clock: { now: () => new Date('2026-09-13T12:02:00.000Z') },
};

test('EntryAccess independently verifies walk-in and queue for only the final five nearby candidates', async () => {
  const walkInCalls = [];
  const queueCalls = [];
  const candidates = Array.from({ length: 6 }, (_, index) => ({
    itemId: `place-${index + 1}`,
    name: `Place ${index + 1}`,
    address: `${index + 1} Ginza`,
  }));
  const provider = {
    async inspectWalkIn(candidate) {
      walkInCalls.push(candidate.itemId);
      if (candidate.itemId === 'place-2') {
        throw new Error('provider response must not leak');
      }
      return {
        policyVersion: 'entry-v1',
        status: 'confirmed',
        sourceUrl: `https://example.test/walk-in/${candidate.itemId}`,
        checkedAt: '2026-09-13T12:00:00.000Z',
      };
    },
    async inspectQueue(candidate) {
      queueCalls.push(candidate.itemId);
      if (candidate.itemId === 'place-1') {
        throw new Error('queue provider failure');
      }
      return {
        status: 'none_reported',
        sourceUrl: `https://example.test/queue/${candidate.itemId}`,
        checkedAt: '2026-09-13T12:01:00.000Z',
        policyVersion: 'entry-v1',
      };
    },
  };

  const enriched = await enrichFinalNearbyCandidatesWithEntryAccess(
    candidates,
    provider,
    policy,
  );

  assert.equal(enriched.length, 5);
  assert.deepEqual(walkInCalls, [
    'place-1',
    'place-2',
    'place-3',
    'place-4',
    'place-5',
  ]);
  assert.deepEqual(queueCalls, walkInCalls);
  assert.deepEqual(enriched[0].entryAccess, {
    walkInAssertion: {
      status: 'confirmed',
      sourceUrl: 'https://example.test/walk-in/place-1',
      checkedAt: '2026-09-13T12:00:00.000Z',
      policyVersion: 'entry-v1',
    },
    queueAssertion: {
      status: 'unknown',
      warning: 'Live queue information is temporarily unavailable.',
    },
  });
  assert.deepEqual(enriched[1].entryAccess, {
    walkInAssertion: {
      status: 'unknown',
      warning: 'Live walk-in information is temporarily unavailable.',
    },
    queueAssertion: {
      status: 'none_reported',
      sourceUrl: 'https://example.test/queue/place-2',
      checkedAt: '2026-09-13T12:01:00.000Z',
      policyVersion: 'entry-v1',
    },
  });
});

test('EntryAccess fails closed for malformed assertions and does not infer walk-in or queue from reservation facts', async () => {
  const candidate = {
    itemId: 'reservable-place',
    name: 'Reservable place',
    address: 'Ginza',
    reservation: { mode: 'advance', label: 'Reservations available' },
  };

  const [enriched] = await enrichFinalNearbyCandidatesWithEntryAccess(
    [candidate],
    {
      async inspectWalkIn() {
        return { status: 'open' };
      },
      async inspectQueue() {
        return { status: 'waiting_reported', waitingMinutes: -1 };
      },
    },
    policy,
  );

  assert.deepEqual(enriched.entryAccess, {
    walkInAssertion: {
      status: 'unknown',
      warning: 'Live walk-in information is unavailable.',
    },
    queueAssertion: {
      status: 'unknown',
      warning: 'Live queue information is unavailable.',
    },
  });
  assert.equal(enriched.reservation.mode, 'advance');
});
