import assert from 'node:assert/strict';
import test from 'node:test';

import { updatePlaceAssessmentResponse } from '../../app/api/items/[id]/personal/update-place-assessment-response.ts';
import { createAtlasApplication } from '../../product/application/atlas-application.ts';
import { createPlaceAssessmentOperationGroup } from '../../product/application/assessments/place-assessment-operations.ts';
import { InMemoryPlaceAssessmentState } from '../../product/application/assessments/in-memory-place-assessment-state.ts';
import { createCatalogRead } from '../../product/application/catalog/catalog-read.ts';
import {
  createAtlasViewModelState,
  reduceAtlasViewModelState,
} from './atlas-view-model-state.ts';

const tabelog = {
  status: 'known',
  score: 3.87,
  url: 'https://tabelog.com/tokyo/A1304/A130404/13286023/',
  provenance: 'owner_asserted',
  assertedAt: '2026-09-24T08:00:00.000Z',
  freshness: 'fresh',
};

const storedAddItem = {
  id: 'spicy-curry-roka',
  kind: 'food',
  title: 'SPICY CURRY 魯珈',
  area: '大久保・新宿',
  address: '東京都新宿区百人町1丁目24-8',
  description: 'Added through Atlas Catalog intake.',
  latitude: 35.7008,
  longitude: 139.6972,
  verificationStatus: 'verified',
  verifiedAt: '2026-09-24T08:00:00.000Z',
  reservation: { mode: 'unknown', label: 'Unknown' },
  personalState: 'saved',
  tags: ['curry'],
  sources: [],
  intakeEvidence: {
    candidateIdentity: {
      providerNamespace: 'google-places',
      placeId: 'spicy-curry-roka-google-place',
    },
    ownerFields: {
      title: 'SPICY CURRY 魯珈',
      address: '東京都新宿区百人町1丁目24-8',
      area: '大久保・新宿',
      coordinates: { latitude: 35.7008, longitude: 139.6972 },
    },
    locationEvidence: {
      status: 'known',
      provenance: 'owner_asserted',
      address: '東京都新宿区百人町1丁目24-8',
      latitude: 35.7008,
      longitude: 139.6972,
      assertedAt: '2026-09-24T08:00:00.000Z',
    },
    tabelog,
    reservation: { status: 'unknown' },
    unknownFields: ['reservation'],
    warnings: [],
  },
  updatedAt: '2026-09-24T08:00:00.000Z',
};

test('T-07 keeps Tabelog 3.87 beside personal score 3.5 across the Web mutation and reload', async () => {
  const recordState = new InMemoryPlaceAssessmentState({
    dynamicPayloads: [JSON.stringify(storedAddItem)],
  });
  const catalog = createCatalogRead(recordState, []);
  const application = createAtlasApplication(
    createPlaceAssessmentOperationGroup(catalog, recordState, {
      clock: { now: () => '2026-09-24T09:00:00.000Z' },
    }),
  );
  const initial = await catalog.get(storedAddItem.id);
  assert.ok(initial && 'address' in initial);
  assert.deepEqual(initial.tabelog, expectedTabelog());

  let viewModel = createAtlasViewModelState({ items: [initial] });
  viewModel = reduceAtlasViewModelState(viewModel, {
    type: 'item.mutation.started',
    itemId: storedAddItem.id,
    mutationId: 't07-personal-rating',
    patch: { personalRating: 3.5 },
  });
  assert.equal(viewModel.items[0].personalRating, 3.5);
  assert.deepEqual(viewModel.items[0].tabelog, expectedTabelog());

  const response = await updatePlaceAssessmentResponse(
    webCoordinator(application),
    new Request(
      `https://atlas.example/api/items/${storedAddItem.id}/personal`,
      {
        method: 'PATCH',
        headers: { 'x-atlas-mutation-id': 't07-personal-rating' },
      },
    ),
    storedAddItem.id,
    { overallRating: 3.5 },
  );
  assert.equal(response.status, 200);
  const receipt = await response.json();
  assert.equal(receipt.result.item.personalRating, 3.5);
  assert.deepEqual(receipt.result.item.tabelog, expectedTabelog());

  viewModel = reduceAtlasViewModelState(viewModel, {
    type: 'item.mutation.succeeded',
    itemId: storedAddItem.id,
    mutationId: 't07-personal-rating',
    item: receipt.result.item,
  });
  assert.equal(viewModel.items[0].personalRating, 3.5);
  assert.deepEqual(viewModel.items[0].tabelog, expectedTabelog());

  const reloaded = await catalog.get(storedAddItem.id);
  assert.ok(reloaded && 'address' in reloaded);
  assert.equal(reloaded.personalRating, 3.5);
  assert.deepEqual(reloaded.tabelog, expectedTabelog());
  assert.deepEqual(reloaded.intakeEvidence?.tabelog, tabelog);
});

function webCoordinator(application) {
  return {
    async mutate(envelope) {
      const result = await application.execute({
        key: envelope.operation,
        input: envelope.input,
      });
      if (!result.ok) return result;
      return {
        ok: true,
        value: {
          mutationId: envelope.mutationId,
          payloadDigest: 'a'.repeat(64),
          result: result.value,
          replayed: false,
        },
      };
    },
  };
}

function expectedTabelog() {
  return {
    score: 3.87,
    url: tabelog.url,
    checkedAt: tabelog.assertedAt,
  };
}
