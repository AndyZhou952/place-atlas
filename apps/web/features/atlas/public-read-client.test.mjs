import assert from 'node:assert/strict';
import test from 'node:test';

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
      displayOrder: 0,
      contentUrl: '/api/media/display/pm_opaque-public-token/content',
    },
  ]);
});
