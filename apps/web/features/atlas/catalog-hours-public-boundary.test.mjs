import assert from 'node:assert/strict';
import test from 'node:test';
import { isAtlasItem } from '../../product/application/catalog/catalog-projection.ts';
import {
  createPublicReadManifest,
  executePublicJsonRead,
} from '../../lib/server/public-read/public-read-manifest.ts';
import { loadPublicCatalog } from './public-read-client.ts';
const observedAt = '2026-01-01T00:00:00.000Z';
const claim = (value) => ({
  value,
  sourceUrl: 'https://example.com/hours',
  observedAt,
});
const benchmark = {
  cases: [
    {
      itemId: 'lunch-dinner',
      name: 'Fixture restaurant A',
      address: '1 Example Street',
      observedAt,
      hoursStatus: 'known',
      weeklyClosureStatus: 'known',
      openingHours: claim('月〜土 11:30 - 14:00; 17:00 - 21:00'),
      regularClosingDays: claim('日曜日'),
    },
    {
      itemId: 'calendar-only',
      name: 'Fixture restaurant B',
      address: '2 Example Street',
      observedAt,
      hoursStatus: 'known',
      weeklyClosureStatus: 'unavailable',
      openingHours: claim('毎日 18:00 - 22:00'),
      closingNotes: claim('年末年始'),
    },
    {
      itemId: 'unavailable',
      name: 'Fixture restaurant C',
      address: '3 Example Street',
      observedAt,
      hoursStatus: 'unavailable',
      weeklyClosureStatus: 'unavailable',
    },
  ],
};

test('generic schedule states survive storage validation, public projection and browser decoding', async () => {
  const items = benchmark.cases.map((sample) => ({
    id: sample.itemId,
    kind: 'food',
    title: sample.name,
    area: '',
    address: sample.address,
    description: '',
    latitude: 35,
    longitude: 139,
    verificationStatus: 'verified',
    verifiedAt: sample.observedAt,
    reservation: {
      mode: 'unknown',
      label: 'Unknown',
      checkedAt: sample.observedAt,
    },
    personalState: 'saved',
    tags: [],
    sources: [],
    ...(sample.openingHours ? { openingHours: sample.openingHours } : {}),
    ...(sample.regularClosingDays
      ? { regularClosingDays: sample.regularClosingDays }
      : {}),
    ...(sample.closingNotes ? { closingNotes: sample.closingNotes } : {}),
    scheduleCheck: {
      openingHours: sample.hoursStatus,
      regularClosingDays: sample.weeklyClosureStatus,
      checkedAt: sample.observedAt,
    },
  }));
  assert.equal(items.length, 3);
  for (const item of items) assert.equal(isAtlasItem(item), true, item.title);
  const response = await executePublicJsonRead({
    manifest: createPublicReadManifest(),
    operation: 'catalog.list',
    principal: { kind: 'anonymous' },
    async load() {
      return items;
    },
  });
  const decoded = await loadPublicCatalog({
    async request(url) {
      return url === '/api/items'
        ? response
        : Response.json({ favorite: false, effectiveVisited: false });
    },
  });
  assert.equal(decoded.length, 3);
  for (const item of decoded) {
    const expected = items.find((source) => source.id === item.id);
    for (const key of [
      'openingHours',
      'regularClosingDays',
      'closingNotes',
      'scheduleCheck',
    ])
      assert.deepEqual(item[key], expected[key], `${item.title}/${key}`);
  }
});

test('checked unavailable schedule fields suppress stale profile fallbacks while legacy profiles still project', async () => {
  const observedAt = '2026-10-04T00:00:00.000Z';
  const staleHours = {
    value: '11:00–22:00',
    sourceUrl: 'https://example.com/old-hours',
    observedAt: '2025-01-01T00:00:00.000Z',
  };
  const staleClosure = {
    value: '火曜日',
    sourceUrl: 'https://example.com/old-hours',
    observedAt: '2025-01-01T00:00:00.000Z',
  };
  const currentHours = {
    value: '11:30–14:00; 17:00–21:00',
    sourceUrl: 'https://example.com/current-hours',
    observedAt,
  };
  const base = {
    kind: 'food',
    area: 'Tokyo',
    address: '1-1 Example, Tokyo',
    description: '',
    latitude: 35,
    longitude: 139,
    verificationStatus: 'verified',
    reservation: { mode: 'unknown', label: 'Unknown', checkedAt: observedAt },
    tags: [],
    sources: [],
    intakeEvidence: {
      profile: {
        openingHours: staleHours,
        regularClosingDays: staleClosure,
      },
      tabelog: { status: 'unknown' },
      reservation: { status: 'unknown' },
      locationEvidence: { status: 'unknown' },
    },
  };
  const response = await executePublicJsonRead({
    manifest: createPublicReadManifest(),
    operation: 'catalog.list',
    principal: { kind: 'anonymous' },
    async load() {
      return [
        {
          ...base,
          id: 'checked-unavailable',
          title: 'Checked unavailable',
          openingHours: currentHours,
          scheduleCheck: {
            openingHours: 'known',
            regularClosingDays: 'unavailable',
            checkedAt: observedAt,
          },
        },
        {
          ...base,
          id: 'legacy-profile',
          title: 'Legacy profile',
        },
        {
          ...base,
          id: 'stale-root-and-owner',
          title: 'Stale root and owner',
          openingHours: staleHours,
          regularClosingDays: staleClosure,
          updatedAt: observedAt,
          intakeEvidence: {
            ...base.intakeEvidence,
            ownerFields: {
              openingHours: staleHours,
              regularClosingDays: staleClosure,
            },
          },
          scheduleCheck: {
            openingHours: 'unavailable',
            regularClosingDays: 'unavailable',
            checkedAt: observedAt,
          },
        },
      ];
    },
  });
  const projected = await response.json();
  assert.equal(response.status, 200);
  assert.equal(projected[0].openingHours.value, currentHours.value);
  assert.equal(projected[0].regularClosingDays, undefined);
  assert.deepEqual(projected[0].scheduleCheck, {
    openingHours: 'known',
    regularClosingDays: 'unavailable',
    checkedAt: observedAt,
  });
  assert.deepEqual(projected[1].openingHours, staleHours);
  assert.deepEqual(projected[1].regularClosingDays, staleClosure);
  assert.equal(projected[2].openingHours, undefined);
  assert.equal(projected[2].regularClosingDays, undefined);
  assert.equal(projected[2].scheduleCheck.openingHours, 'unavailable');
  assert.equal(projected[2].scheduleCheck.regularClosingDays, 'unavailable');
});
