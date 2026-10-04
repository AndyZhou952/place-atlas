import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPublicReadManifest,
  executePublicJsonRead,
} from '../../lib/server/public-read/public-read-manifest.ts';
import { sortJournalVisits } from './journal-filter.ts';
import { loadPublicCatalog, loadPublicMedia } from './public-read-client.ts';

void test('public assessment overallComment enters the browser catalog model', async () => {
  const result = await loadPublicCatalog({
    async request(url) {
      if (url === '/api/items') {
        return Response.json([
          {
            id: 'item-1',
            kind: 'food',
            title: 'Kissa Atlas',
            area: 'Ginza',
            address: 'Tokyo',
            description: 'A quiet counter.',
            latitude: 35.67,
            longitude: 139.76,
            verificationStatus: 'verified',
            tags: [],
            sources: [],
            reservation: {
              mode: 'walk-in',
              label: 'Walk in',
              checkedAt: '2026-09-20',
            },
          },
        ]);
      }
      assert.equal(url, '/api/items/item-1/personal');
      return Response.json({
        itemId: 'item-1',
        favorite: false,
        manualVisited: false,
        effectiveVisited: false,
        personalRating: 4.5,
        overallComment: 'The kissaten I would return to for a slow morning.',
      });
    },
  });

  assert.equal(
    result[0]?.overallComment,
    'The kissaten I would return to for a slow morning.',
  );
});

void test('manifest intake evidence decodes into complete browser reservation and rating view models', async () => {
  const manifestResponse = await executePublicJsonRead({
    manifest: createPublicReadManifest(),
    operation: 'catalog.list',
    principal: { kind: 'anonymous' },
    async load() {
      return [
        intakeCatalogItem('known-intake', {
          tabelog: {
            status: 'known',
            score: 4.21,
            url: 'https://tabelog.com/tokyo/A0000/A000000/00000000/',
            provenance: 'owner_asserted',
            assertedAt: '2026-09-23T09:00:00.000Z',
            freshness: 'fresh',
          },
          reservation: {
            status: 'known',
            mode: 'reservation_required',
            label: 'Advance reservation required',
            url: 'https://example.com/reservations',
            provenance: 'agent_observed',
            observedAt: '2026-09-23T10:00:00.000Z',
            freshness: 'fresh',
          },
        }),
        intakeCatalogItem('unknown-intake', {
          tabelog: { status: 'unknown' },
          reservation: { status: 'unknown' },
        }),
      ];
    },
  });
  const result = await loadPublicCatalog({
    async request(url) {
      if (url === '/api/items') return manifestResponse;
      return Response.json({
        favorite: false,
        effectiveVisited: false,
      });
    },
  });

  assert.deepEqual(result[0].reservation, {
    mode: 'advance',
    label: 'Advance reservation required',
    url: 'https://example.com/reservations',
    checkedAt: '2026-09-23T10:00:00.000Z',
  });
  assert.deepEqual(result[0].tabelog, {
    score: 4.21,
    url: 'https://tabelog.com/tokyo/A0000/A000000/00000000/',
    checkedAt: '2026-09-23T09:00:00.000Z',
  });
  assert.deepEqual(result[1].reservation, {
    mode: 'unknown',
    label: 'Unknown',
  });
  assert.equal(result[1].tabelog, undefined);
});

void test('authenticated media reads keep private internal IDs for owner editing', async () => {
  const urls = [];
  const records = [
    {
      id: 'internal-media-1',
      visitId: 'visit-1',
      itemId: 'item-1',
      originalFilename: 'private.jpg',
      caption: 'Dinner',
      displayOrder: 0,
      contentUrl: '/api/media/internal-media-1/content',
    },
  ];
  const result = await loadPublicMedia(
    {
      async request(url) {
        urls.push(url);
        return Response.json(records);
      },
    },
    { visitId: 'visit-1' },
  );

  assert.deepEqual(urls, ['/api/media?visitId=visit-1']);
  assert.deepEqual(result, records);
});

void test('anonymous media reads fall back to closed public visit DTOs', async () => {
  const urls = [];
  const result = await loadPublicMedia(
    {
      async request(url) {
        urls.push(url);
        if (url.startsWith('/api/media')) {
          return new Response('Owner login is required.', { status: 401 });
        }
        return Response.json([
          {
            id: 'visit-1',
            itemId: 'item-1',
            visitedOn: '2026-09-01',
            media: [
              {
                id: 'pm_opaque-public-token',
                visitId: 'visit-1',
                displayOrder: 0,
                caption: 'Dinner',
                contentType: 'image/jpeg',
                displayUrl: '/api/media/display/pm_opaque-public-token/content',
              },
            ],
          },
        ]);
      },
    },
    { itemId: 'item-1' },
  );

  assert.deepEqual(urls, ['/api/media?itemId=item-1', '/api/journal']);
  assert.deepEqual(result, [
    {
      id: 'pm_opaque-public-token',
      visitId: 'visit-1',
      itemId: 'item-1',
      originalFilename: 'Photo',
      caption: 'Dinner',
      contentType: 'image/jpeg',
      displayOrder: 0,
      contentUrl: '/api/media/display/pm_opaque-public-token/content',
    },
  ]);
});

function intakeCatalogItem(id, evidence) {
  return {
    id,
    kind: 'food',
    title: id,
    area: 'Ginza',
    address: '1 Ginza, Tokyo',
    description: 'Added through intake.',
    latitude: 35.671,
    longitude: 139.765,
    verificationStatus: 'verified',
    verifiedAt: '2026-09-23T11:00:00.000Z',
    reservation: { mode: 'unknown', label: 'Legacy placeholder' },
    personalState: 'candidate',
    tags: [],
    sources: [],
    intakeEvidence: {
      candidateIdentity: {
        providerNamespace: 'google-places',
        placeId: `${id}-place`,
      },
      ownerFields: { title: id },
      locationEvidence: {
        status: 'known',
        provenance: 'owner_asserted',
        address: '1 Ginza, Tokyo',
        latitude: 35.671,
        longitude: 139.765,
        assertedAt: '2026-09-23T08:00:00.000Z',
      },
      ...evidence,
      unknownFields: [],
      warnings: [],
    },
  };
}

void test('the browser loads a mixed catalog with policy-only reservations and sourced schedules', async () => {
  const listingUrl = 'https://tabelog.com/tokyo/A1317/A131701/13000001/';
  const observedAt = '2026-10-04T00:00:00.000Z';
  const facts = {
    tabelog: {
      status: 'known',
      score: 3.5,
      url: listingUrl,
      provenance: 'agent_observed',
      observedAt,
      freshness: 'fresh',
    },
    reservation: {
      status: 'known',
      mode: 'reservable',
      label: '予約可',
      url: listingUrl,
      provenance: 'agent_observed',
      observedAt,
      freshness: 'fresh',
    },
  };
  const hours = {
    value: '月〜金 17:00 - 23:00; 土・日 12:00 - 14:00',
    sourceUrl: 'https://restaurant.example/branch',
    observedAt,
  };
  const closed = {
    value: '祝日',
    sourceUrl: 'https://restaurant.example/branch',
    observedAt,
  };
  const response = await executePublicJsonRead({
    manifest: createPublicReadManifest(),
    operation: 'catalog.list',
    principal: { kind: 'anonymous' },
    async load() {
      return [
        intakeCatalogItem('policy-only', facts),
        intakeCatalogItem('with-hours', {
          ...facts,
          profile: {
            bookingLink: {
              value: 'https://yoyaku.toreta.in/restaurant-branch/#/',
              sourceUrl: 'https://yoyaku.toreta.in/restaurant-branch/#/',
              observedAt,
            },
            openingHours: hours,
            regularClosingDays: closed,
          },
        }),
      ];
    },
  });
  const items = await loadPublicCatalog({
    async request(url) {
      if (url === '/api/items') return response;
      return Response.json({ favorite: false, effectiveVisited: false });
    },
  });
  assert.equal(items.length, 2);
  assert.equal(items[0].reservation.url, undefined);
  assert.equal(items[0].reservation.label, '予約可');
  assert.equal(
    items[1].reservation.url,
    'https://yoyaku.toreta.in/restaurant-branch/#/',
  );
  assert.deepEqual(items[1].openingHours, hours);
  assert.deepEqual(items[1].regularClosingDays, closed);
});

void test('Owner full catalog retains classification and skips unpublished candidate assessments', async () => {
  const urls = [];
  const classification = {
    cuisines: [{ familyId: 'japanese', categoryId: 'japanese.ramen' }],
    geography: {
      countryCode: 'JP',
      subdivisionCode: 'JP-13',
      subdivisionName: '東京都',
    },
    basis: { cuisineLabels: ['ラーメン'], address: '東京都新宿区' },
  };
  const items = await loadPublicCatalog(
    {
      async request(url) {
        urls.push(url);
        if (url === '/api/items?profile=full_merged_catalog')
          return Response.json([
            {
              id: 'candidate',
              kind: 'food',
              title: 'Unpublished',
              area: '',
              address: '',
              description: '',
              latitude: 0,
              longitude: 0,
              verificationStatus: 'needs_review',
              reservation: { status: 'unknown' },
              tags: [],
              sources: [],
              classification,
              updatedAt: '2026-10-02T00:00:00Z',
            },
          ]);
        throw new Error('Candidate must not request a public assessment');
      },
    },
    'full_merged_catalog',
  );
  assert.deepEqual(urls, ['/api/items?profile=full_merged_catalog']);
  assert.deepEqual(items[0].classification, classification);
  assert.equal(items[0].updatedAt, '2026-10-02T00:00:00Z');
  assert.equal(items[0].verifiedAt, '');
  assert.equal(items[0].personalRating, undefined);
});

void test('public Journal roundtrip retains entry timestamps independently of visit date', async () => {
  const raw = [
    {
      id: 'visit-later-entry',
      itemId: 'item-1',
      visitedAt: '2020-01-01',
      createdAt: '2026-10-02T10:00:00Z',
      updatedAt: '2026-10-02T11:00:00Z',
      media: [],
    },
    {
      id: 'visit-earlier-entry',
      itemId: 'item-1',
      visitedAt: '2026-10-02',
      createdAt: '2026-10-01T10:00:00Z',
      updatedAt: '2026-10-01T10:00:00Z',
      media: [],
    },
  ];
  const response = await executePublicJsonRead({
    manifest: createPublicReadManifest(),
    operation: 'visit.listDisplay',
    principal: { kind: 'anonymous' },
    async load() {
      return raw;
    },
  });
  assert.equal(response.status, 200);
  const { loadPublicVisits } = await import('./public-read-client.ts');
  const visits = await loadPublicVisits({
    async request(url) {
      return url === '/api/journal'
        ? response
        : Response.json({ title: 'Atlas' });
    },
  });
  assert.equal(visits[0].createdAt, raw[0].createdAt);
  assert.equal(visits[0].updatedAt, raw[0].updatedAt);
  assert.equal(visits[0].visitedAt, raw[0].visitedAt);
  assert.deepEqual(
    sortJournalVisits(visits, 'recorded-asc').map((v) => v.id),
    ['visit-earlier-entry', 'visit-later-entry'],
  );
});

void test('saved Google Place ID survives the closed catalog projection for Map and Table lookup', async () => {
  const source = intakeCatalogItem('google-id', {
    tabelog: { status: 'unknown' },
    reservation: { status: 'unknown' },
  });
  source.intakeEvidence.candidateIdentity = {
    providerNamespace: 'google-places',
    placeId: 'ChIJ1234567890',
  };
  const response = await executePublicJsonRead({
    manifest: createPublicReadManifest(),
    operation: 'catalog.list',
    principal: { kind: 'anonymous' },
    async load() {
      return [source];
    },
  });
  const catalog = await loadPublicCatalog({
    async request(url) {
      return url === '/api/items'
        ? response
        : Response.json({ favorite: false, effectiveVisited: false });
    },
  });
  const { ratingPlaceId } = await import('../../agent/google-rating-policy.ts');
  assert.equal(catalog[0].googlePlaceId, 'ChIJ1234567890');
  assert.equal(ratingPlaceId(catalog[0]), 'ChIJ1234567890');
  assert.equal(catalog[0].intakeEvidence, undefined);
});
