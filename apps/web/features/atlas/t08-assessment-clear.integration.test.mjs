import assert from 'node:assert/strict';
import test from 'node:test';

import { updatePlaceAssessmentResponse } from '../../app/api/items/[id]/personal/update-place-assessment-response.ts';
import { createAtlasApplication } from '../../product/application/atlas-application.ts';
import { createPlaceAssessmentOperationGroup } from '../../product/application/assessments/place-assessment-operations.ts';
import { InMemoryPlaceAssessmentState } from '../../product/application/assessments/in-memory-place-assessment-state.ts';
import { createCatalogRead } from '../../product/application/catalog/catalog-read.ts';
import { createBrowserAtlasApplication } from './atlas-api-client.ts';
import {
  createAtlasViewModelState,
  reduceAtlasViewModelState,
} from './atlas-view-model-state.ts';

const tabelogEvidence = {
  status: 'known',
  score: 3.87,
  url: 'https://tabelog.com/tokyo/A1304/A130404/13286023/',
  provenance: 'owner_asserted',
  assertedAt: '2026-09-24T08:00:00.000Z',
  freshness: 'fresh',
};

const storedAddItem = {
  id: 'spicy-curry-roka-clear',
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
    tabelog: tabelogEvidence,
    reservation: { status: 'unknown' },
    unknownFields: ['reservation'],
    warnings: [],
  },
  updatedAt: '2026-09-24T08:00:00.000Z',
};

test('T-08 clears personal rating and comment through HTTP without clearing Tabelog facts', async () => {
  const recordState = new InMemoryPlaceAssessmentState({
    dynamicPayloads: [JSON.stringify(storedAddItem)],
  });
  const catalog = createCatalogRead(recordState, []);
  const application = createAtlasApplication(
    createPlaceAssessmentOperationGroup(catalog, recordState, {
      clock: { now: () => '2026-09-24T09:00:00.000Z' },
    }),
  );
  const coordinator = webCoordinator(application);
  const browserApplication = createBrowserAtlasApplication({
    async request(url, init) {
      assert.equal(url, `/api/items/${storedAddItem.id}/personal`);
      if (typeof init?.body !== 'string') {
        throw new Error('Expected the assessment request to use a JSON body.');
      }
      return updatePlaceAssessmentResponse(
        coordinator,
        new Request(`https://atlas.example${url}`, init),
        storedAddItem.id,
        JSON.parse(init.body),
      );
    },
  });

  const initial = await catalog.get(storedAddItem.id);
  assert.ok(initial && 'address' in initial);
  let viewModel = createAtlasViewModelState({ items: [initial] });

  const populated = await browserApplication.execute({
    key: 'assessment.update',
    input: {
      itemId: storedAddItem.id,
      patch: {
        overallRating: 3.5,
        summary: 'Spicy, fragrant, and worth revisiting.',
      },
    },
    mutationId: 't08-populate-assessment',
  });
  viewModel = reduceAtlasViewModelState(viewModel, {
    type: 'item.mutation.started',
    itemId: storedAddItem.id,
    mutationId: 't08-populate-assessment',
    patch: {
      personalRating: 3.5,
      overallComment: 'Spicy, fragrant, and worth revisiting.',
    },
  });
  viewModel = reduceAtlasViewModelState(viewModel, {
    type: 'item.mutation.succeeded',
    itemId: storedAddItem.id,
    mutationId: 't08-populate-assessment',
    item: populated,
  });
  assert.equal(viewModel.items[0].personalRating, 3.5);
  assert.equal(
    viewModel.items[0].overallComment,
    'Spicy, fragrant, and worth revisiting.',
  );

  viewModel = reduceAtlasViewModelState(viewModel, {
    type: 'item.mutation.started',
    itemId: storedAddItem.id,
    mutationId: 't08-clear-assessment',
    patch: { personalRating: undefined, overallComment: undefined },
  });
  const cleared = await browserApplication.execute({
    key: 'assessment.update',
    input: {
      itemId: storedAddItem.id,
      patch: { overallRating: null, summary: null },
    },
    mutationId: 't08-clear-assessment',
  });

  assert.equal('personalRating' in cleared, true);
  assert.equal(cleared.personalRating, undefined);
  assert.equal('overallComment' in cleared, true);
  assert.equal(cleared.overallComment, undefined);
  viewModel = reduceAtlasViewModelState(viewModel, {
    type: 'item.mutation.succeeded',
    itemId: storedAddItem.id,
    mutationId: 't08-clear-assessment',
    item: cleared,
  });
  assert.equal(viewModel.items[0].personalRating, undefined);
  assert.equal(viewModel.items[0].overallComment, undefined);
  assert.equal(viewModel.items[0].tabelog?.score, 3.87);

  const reloaded = await catalog.get(storedAddItem.id);
  assert.ok(reloaded && 'address' in reloaded);
  assert.equal(reloaded.personalRating, undefined);
  assert.equal(reloaded.overallComment, undefined);
  assert.equal(reloaded.tabelog?.score, 3.87);
  assert.deepEqual(reloaded.intakeEvidence?.tabelog, tabelogEvidence);
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
