import { toD1 } from '../../test-support/d1.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  createD1OwnerPocCatalogRead,
  createD1OwnerPocPersonalFactsRead,
} from './d1-owner-poc-catalog.ts';

const schemaUrl = new URL(
  '../../migrations/owner-poc/0001_owner_poc_schema.sql',
  import.meta.url,
);
const catalogIntakePublicationUrl = new URL(
  '../../migrations/owner-poc/0008_catalog_intake_publication.sql',
  import.meta.url,
);

function item(id, overrides = {}) {
  return {
    id,
    kind: 'food',
    title: `Title ${id}`,
    area: 'Tokyo',
    address: 'Tokyo address',
    description: `Description ${id}`,
    latitude: 35.68,
    longitude: 139.76,
    verificationStatus: 'verified',
    verifiedAt: '2026-09-21',
    reservation: {
      mode: 'unknown',
      label: 'Unknown',
      checkedAt: '2026-09-21',
    },
    personalState: 'candidate',
    tags: [],
    sources: [],
    ...overrides,
  };
}

function reviewCandidate(id) {
  return {
    recordType: 'review_candidate',
    id,
    kind: 'food',
    title: 'Needs review restaurant',
    description: 'Added through Atlas Catalog intake for owner review.',
    verificationStatus: 'needs_review',
    personalState: 'saved',
    tags: [],
    reviewEvidence: {
      candidateIdentity: {
        providerNamespace: 'google-places',
        placeId: 'google-place-needs-review',
      },
      ownerFields: {},
      titleProposal: {
        provenance: 'owner_query',
        value: 'Needs review restaurant',
      },
      locationEvidence: { status: 'unknown' },
      tabelog: { status: 'unknown' },
      reservation: { status: 'unknown' },
      unknownFields: ['address', 'coordinates', 'tabelog', 'reservation'],
      warnings: [
        {
          code: 'needs_review',
          message:
            'Confirm or complete the durable place details before publishing.',
        },
      ],
    },
    updatedAt: '2026-09-25T05:47:09.577Z',
  };
}

test('the owner-poc Agent CatalogRead projects canonical Web catalog and personal state without consulting the legacy Agent catalog', async () => {
  const database = new DatabaseSync(':memory:');
  database.exec(await readFile(schemaUrl, 'utf8'));
  database.exec(await readFile(catalogIntakePublicationUrl, 'utf8'));
  const canonical = item('canonical-only');
  const awaitingReview = reviewCandidate('awaiting-review');
  insertCanonical(database, canonical);
  insertReviewCandidate(database, awaitingReview);
  database
    .prepare(
      `INSERT INTO atlas_item_overrides (
        item_id, title, description, personal_state, updated_at
      ) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      canonical.id,
      'Owner title',
      'Owner description',
      'saved',
      '2026-09-21T10:00:00.000Z',
    );
  database
    .prepare(
      `INSERT INTO place_assessments (
        item_id, overall_rating, is_favorite, has_visited, summary,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      canonical.id,
      4.5,
      1,
      0,
      'Great',
      '2026-09-21T10:00:00.000Z',
      '2026-09-21T10:00:00.000Z',
    );
  insertVisit(database, 'visit-1', canonical.id, '2026-09-20T12:00:00.000Z');

  const catalog = createD1OwnerPocCatalogRead(toD1(database));

  assert.deepEqual(await catalog.list('verified_catalog'), [
    {
      ...canonical,
      title: 'Owner title',
      description: 'Owner description',
      personalState: 'saved',
      personalRating: 4.5,
      isFavorite: true,
      hasVisited: true,
      updatedAt: '2026-09-21T10:00:00.000Z',
    },
  ]);
  assert.equal(
    (await catalog.list('full_merged_catalog')).some(
      ({ id }) => id === awaitingReview.id,
    ),
    true,
  );
  assert.deepEqual(await catalog.get(awaitingReview.id), {
    ...awaitingReview,
    personalRating: undefined,
    isFavorite: false,
    hasVisited: false,
  });
});

test('the owner-poc personal-facts reader returns manual status, visits, latest visit, and rating from the shared Web tables', async () => {
  const database = new DatabaseSync(':memory:');
  database.exec(await readFile(schemaUrl, 'utf8'));
  const canonical = item('facts');
  insertCanonical(database, canonical);
  database
    .prepare(
      `INSERT INTO place_assessments (
        item_id, overall_rating, is_favorite, has_visited, summary,
        created_at, updated_at
      ) VALUES (?, ?, 0, 1, NULL, ?, ?)`,
    )
    .run(
      canonical.id,
      4.75,
      '2026-09-21T10:00:00.000Z',
      '2026-09-21T10:00:00.000Z',
    );
  insertVisit(
    database,
    'visit-older',
    canonical.id,
    '2026-09-19T12:00:00.000Z',
  );
  insertVisit(
    database,
    'visit-latest',
    canonical.id,
    '2026-09-20T12:00:00.000Z',
  );

  const personalFacts = createD1OwnerPocPersonalFactsRead(toD1(database));

  assert.deepEqual(await personalFacts.read(canonical.id), {
    manualVisited: true,
    visitCount: 2,
    latestVisitAt: '2026-09-20T12:00:00.000Z',
    personalRating: 4.75,
  });
  assert.deepEqual(await personalFacts.read('missing'), {
    manualVisited: false,
    visitCount: 0,
  });
});

function insertCanonical(database, candidate) {
  database
    .prepare(
      `INSERT INTO atlas_items (
        id, payload_json, verification_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      candidate.id,
      JSON.stringify(candidate),
      candidate.verificationStatus,
      '2026-09-21T00:00:00.000Z',
      '2026-09-21T00:00:00.000Z',
    );
}

function insertReviewCandidate(database, candidate) {
  database
    .prepare(
      `INSERT INTO atlas_review_candidates (
        id, payload_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?)`,
    )
    .run(
      candidate.id,
      JSON.stringify(candidate),
      candidate.updatedAt,
      candidate.updatedAt,
    );
}

function insertVisit(database, id, itemId, visitedAt) {
  database
    .prepare(
      `INSERT INTO visits (
        id, item_id, item_title, visited_at, note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, ?, ?)`,
    )
    .run(id, itemId, itemId, visitedAt, visitedAt, visitedAt);
}
