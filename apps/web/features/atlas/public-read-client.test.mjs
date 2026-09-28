import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPublicReadManifest,
  executePublicJsonRead,
} from '../../lib/server/public-read/public-read-manifest.ts';
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
                score: 4.2,
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
      score: 4.2,
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
