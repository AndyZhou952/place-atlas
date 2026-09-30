import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createPublicReadManifest,
  executePublicJsonRead,
  executePublicMediaRead,
} from './public-read-manifest.ts';

const anonymous = { kind: 'anonymous' };

void test('an unknown public read is rejected before Application or R2 is called', async () => {
  const manifest = createPublicReadManifest();
  let applicationCalls = 0;
  let r2Calls = 0;

  const json = await executePublicJsonRead({
    manifest,
    operation: 'audit.list',
    principal: anonymous,
    async load() {
      applicationCalls += 1;
      return { auditSecret: 'must-not-load' };
    },
  });
  const media = await executePublicMediaRead({
    manifest,
    operation: 'media.open',
    principal: anonymous,
    async load() {
      r2Calls += 1;
      return {
        body: new ReadableStream(),
        contentType: 'image/jpeg',
      };
    },
  });

  assert.equal(json.status, 404);
  assert.equal(media.status, 404);
  assert.equal(applicationCalls, 0);
  assert.equal(r2Calls, 0);
});

void test('catalog projection is a closed v1 DTO and drops domain sentinel and internal fields', async () => {
  const response = await executePublicJsonRead({
    manifest: createPublicReadManifest(),
    operation: 'catalog.get',
    principal: anonymous,
    async load() {
      return {
        id: 'place-1',
        kind: 'food',
        title: 'Sushi',
        alternateTitle: '鮨',
        area: 'Ginza',
        address: '1 Ginza, Tokyo',
        description: 'Counter sushi',
        latitude: 35.671,
        longitude: 139.765,
        verificationStatus: 'verified',
        verifiedAt: '2026-09-20',
        officialUrl: 'https://example.com',
        tabelog: {
          score: 3.8,
          reviewCount: 42,
          url: 'https://tabelog.example/place-1',
          checkedAt: '2026-09-20',
          providerPayload: 'secret',
        },
        reservation: {
          mode: 'advance',
          label: 'Reservation recommended',
          channel: 'web',
          url: 'https://example.com/book',
          advanceDays: 14,
          bookingWindowLabel: 'Two weeks',
          releaseNote: 'At noon',
          checkedAt: '2026-09-20',
          internalStatus: 'hidden',
        },
        tags: ['sushi'],
        sources: [
          {
            label: 'Official',
            url: 'https://example.com',
            role: 'official',
            contentHash: 'secret',
          },
        ],
        personalState: 'saved',
        isFavorite: true,
        updatedAt: 'internal',
        objectKey: 'private/catalog/place-1',
        auditReceipt: 'receipt',
        __projectionSentinel: 'must-not-leak',
      };
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    id: 'place-1',
    kind: 'food',
    title: 'Sushi',
    alternateTitle: '鮨',
    area: 'Ginza',
    address: '1 Ginza, Tokyo',
    description: 'Counter sushi',
    latitude: 35.671,
    longitude: 139.765,
    verificationStatus: 'verified',
    verifiedAt: '2026-09-20',
    officialUrl: 'https://example.com',
    tabelog: {
      score: 3.8,
      reviewCount: 42,
      url: 'https://tabelog.example/place-1',
      checkedAt: '2026-09-20',
    },
    reservation: {
      mode: 'advance',
      label: 'Reservation recommended',
      channel: 'web',
      url: 'https://example.com/book',
      advanceDays: 14,
      bookingWindowLabel: 'Two weeks',
      releaseNote: 'At noon',
      checkedAt: '2026-09-20',
    },
    tags: ['sushi'],
    sources: [
      {
        label: 'Official',
        url: 'https://example.com',
        role: 'official',
      },
    ],
  });
});

void test('intake catalog projection preserves exact provenance, time, license, and unknown evidence branches', async () => {
  const response = await executePublicJsonRead({
    manifest: createPublicReadManifest(),
    operation: 'catalog.get',
    principal: anonymous,
    async load() {
      return {
        id: 'intake-place',
        kind: 'food',
        title: 'Owner place',
        area: 'Ginza',
        address: '1 Ginza, Tokyo',
        description: 'Added through intake',
        latitude: 35.671,
        longitude: 139.765,
        verificationStatus: 'verified',
        verifiedAt: '2026-09-23T12:00:00.000Z',
        tabelog: {
          score: 4.12,
          url: 'https://tabelog.com/tokyo/A0000/A000000/00000000/',
          checkedAt: '2026-09-23T12:00:00.000Z',
        },
        reservation: {
          mode: 'unknown',
          label: 'Legacy display only',
          checkedAt: '2026-09-23T12:00:00.000Z',
        },
        tags: [],
        sources: [
          {
            role: 'discovery',
            label: 'Legacy display only',
            url: 'https://legacy.invalid/',
          },
        ],
        intakeEvidence: {
          candidateIdentity: {
            providerNamespace: 'google-places',
            placeId: 'place-1',
          },
          ownerFields: { title: 'Owner place' },
          locationEvidence: {
            status: 'known',
            provenance: 'durable_geocoder_observed',
            normalizedAddress: '1 Ginza, Tokyo',
            latitude: 35.671,
            longitude: 139.765,
            provider: 'OpenStreetMap Nominatim',
            sourceUrl:
              'https://nominatim.openstreetmap.org/ui/details.html?place_id=1',
            license: 'ODbL-1.0',
            checkedAt: '2026-09-23T10:00:00.000Z',
          },
          tabelog: {
            status: 'known',
            score: 4.12,
            url: 'https://tabelog.com/tokyo/A0000/A000000/00000000/',
            provenance: 'owner_asserted',
            assertedAt: '2026-09-23T11:00:00.000Z',
            freshness: 'fresh',
          },
          reservation: { status: 'unknown' },
          unknownFields: ['reservation'],
          warnings: [],
        },
      };
    },
  });

  assert.equal(response.status, 200);
  const projected = await response.json();
  assert.deepEqual(projected.tabelog, {
    status: 'known',
    score: 4.12,
    url: 'https://tabelog.com/tokyo/A0000/A000000/00000000/',
    provenance: 'owner_asserted',
    assertedAt: '2026-09-23T11:00:00.000Z',
    freshness: 'fresh',
  });
  assert.deepEqual(projected.reservation, { status: 'unknown' });
  assert.deepEqual(projected.sources, [
    {
      role: 'location',
      label: 'OpenStreetMap Nominatim',
      url: 'https://nominatim.openstreetmap.org/ui/details.html?place_id=1',
      provenance: 'durable_geocoder_observed',
      checkedAt: '2026-09-23T10:00:00.000Z',
      license: 'ODbL-1.0',
    },
    {
      role: 'tabelog',
      label: 'Tabelog',
      url: 'https://tabelog.com/tokyo/A0000/A000000/00000000/',
      provenance: 'owner_asserted',
      assertedAt: '2026-09-23T11:00:00.000Z',
    },
  ]);
  assert.equal(
    JSON.stringify(projected).includes('checkedAt":"2026-09-23T12'),
    false,
  );
});

void test('authoritative intake unknown evidence never falls back to inconsistent legacy fields', async () => {
  const response = await executePublicJsonRead({
    manifest: createPublicReadManifest(),
    operation: 'catalog.get',
    principal: anonymous,
    async load() {
      return {
        id: 'inconsistent-intake',
        kind: 'food',
        title: 'Unknown evidence place',
        area: 'Ginza',
        address: '1 Ginza, Tokyo',
        description: 'Awaiting evidence.',
        latitude: 35.671,
        longitude: 139.765,
        verificationStatus: 'verified',
        verifiedAt: '2026-09-23T12:00:00.000Z',
        tabelog: {
          score: 4.99,
          url: 'https://tabelog.com/tokyo/A0000/A000000/99999999/',
          checkedAt: '2026-09-23T12:00:00.000Z',
        },
        reservation: {
          mode: 'advance',
          label: 'Legacy reservation',
          checkedAt: '2026-09-23T12:00:00.000Z',
        },
        tags: [],
        sources: [
          {
            role: 'tabelog',
            label: 'Legacy Tabelog',
            url: 'https://tabelog.com/tokyo/A0000/A000000/99999999/',
          },
        ],
        intakeEvidence: {
          candidateIdentity: {
            providerNamespace: 'google-places',
            placeId: 'place-unknown',
          },
          ownerFields: { title: 'Unknown evidence place' },
          locationEvidence: { status: 'unknown' },
          tabelog: { status: 'unknown' },
          reservation: { status: 'unknown' },
          unknownFields: ['tabelog', 'reservation'],
          warnings: [],
        },
      };
    },
  });

  assert.equal(response.status, 200);
  const projected = await response.json();
  assert.equal(projected.tabelog, undefined);
  assert.deepEqual(projected.reservation, { status: 'unknown' });
  assert.deepEqual(projected.sources, []);
  assert.deepEqual(Object.keys(projected).sort(), [
    'address',
    'area',
    'description',
    'id',
    'kind',
    'latitude',
    'longitude',
    'reservation',
    'sources',
    'tags',
    'title',
    'verificationStatus',
    'verifiedAt',
  ]);
  assert.doesNotMatch(JSON.stringify(projected), /4\.99|Legacy/u);
});

void test('assessment and visit projections expose only approved display fields', async () => {
  const manifest = createPublicReadManifest();
  const assessment = await executePublicJsonRead({
    manifest,
    operation: 'assessment.display',
    principal: anonymous,
    async load() {
      return {
        itemId: 'place-1',
        isFavorite: true,
        manualVisited: false,
        effectiveVisited: true,
        overallRating: 4.4,
        summary: 'Return for lunch',
        updatedAt: 'private',
        __projectionSentinel: 'must-not-leak',
      };
    },
  });
  const visits = await executePublicJsonRead({
    manifest,
    operation: 'visit.listDisplay',
    principal: anonymous,
    async load() {
      return [
        {
          id: 'visit-1',
          itemId: 'place-1',
          visitedAt: '2026-09-20',
          note: 'Omakase',
          createdAt: 'private',
          media: [
            {
              displayId: 'pm_opaque_1',
              visitId: 'visit-1',
              displayOrder: 0,
              caption: 'Nigiri',
              score: 4.2,
              contentType: 'image/jpeg',
              objectKey: 'visits/visit-1/internal-1',
              originalFilename: 'IMG_0001.jpg',
              contentSha256: 'secret-hash',
              internalStorageId: 'internal-1',
              __projectionSentinel: 'must-not-leak',
            },
          ],
          __projectionSentinel: 'must-not-leak',
        },
      ];
    },
  });

  assert.deepEqual(await assessment.json(), {
    itemId: 'place-1',
    favorite: true,
    manualVisited: false,
    effectiveVisited: true,
    personalRating: 4.4,
    overallComment: 'Return for lunch',
  });
  assert.deepEqual(await visits.json(), [
    {
      id: 'visit-1',
      itemId: 'place-1',
      visitedOn: '2026-09-20',
      displayNote: 'Omakase',
      media: [
        {
          id: 'pm_opaque_1',
          visitId: 'visit-1',
          displayOrder: 0,
          caption: 'Nigiri',
          contentType: 'image/jpeg',
          displayUrl: '/api/media/pm_opaque_1/content',
        },
      ],
    },
  ]);
});

void test('display media allows supported photos and videos with fixed public headers', async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(Uint8Array.of(1, 2, 3));
      controller.close();
    },
  });
  const response = await executePublicMediaRead({
    manifest: createPublicReadManifest(),
    operation: 'media.openDisplay',
    principal: anonymous,
    async load() {
      return {
        body,
        contentType: 'image/jpeg',
        objectKey: 'must-not-become-a-header',
        originalFilename: 'must-not-become-a-header.jpg',
        etag: 'must-not-become-a-header',
      };
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(
    [...response.headers.entries()],
    [
      ['cache-control', 'public, max-age=3600'],
      ['content-disposition', 'inline'],
      ['content-type', 'image/jpeg'],
    ],
  );
  assert.deepEqual(
    new Uint8Array(await response.arrayBuffer()),
    Uint8Array.of(1, 2, 3),
  );

  for (const contentType of ['video/mp4', 'video/webm']) {
    const video = await executePublicMediaRead({
      manifest: createPublicReadManifest(),
      operation: 'media.openDisplay',
      principal: anonymous,
      async load() {
        return { body: new ReadableStream(), contentType };
      },
    });
    assert.equal(video.status, 200);
    assert.equal(video.headers.get('content-type'), contentType);
  }

  const refused = await executePublicMediaRead({
    manifest: createPublicReadManifest(),
    operation: 'media.openDisplay',
    principal: anonymous,
    async load() {
      return {
        body: new ReadableStream(),
        contentType: 'text/html',
      };
    },
  });
  assert.equal(refused.status, 415);
});
