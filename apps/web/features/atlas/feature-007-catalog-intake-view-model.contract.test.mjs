import assert from 'node:assert/strict';
import test from 'node:test';

import {
  catalogIntakeInitialState,
  catalogIntakeLiveMessage,
  catalogIntakePendingMessage,
  reduceCatalogIntakeUi,
} from './catalog-intake-ui-state.ts';

test('ambiguous candidates require a choice; area refinement invalidates stale results but retains name', () => {
  let state = {
    ...catalogIntakeInitialState(),
    query: '鳥貴族',
    requestToken: 'old',
  };
  state = reduceCatalogIntakeUi(state, {
    type: 'discover_succeeded',
    output: discoverOutput([candidate(), { ...candidate(), ordinal: 2 }]),
  });
  assert.equal(state.selectedOrdinal, undefined);
  state = reduceCatalogIntakeUi(state, {
    type: 'candidate_selected',
    ordinal: 2,
  });
  assert.equal(state.selectedOrdinal, 2);
  state = reduceCatalogIntakeUi(state, {
    type: 'field_changed',
    field: 'searchArea',
    value: '新宿西口',
  });
  assert.equal(state.query, '鳥貴族');
  assert.equal(state.searchArea, '新宿西口');
  assert.equal(state.stage, 'idle');
  assert.equal(state.requestToken, undefined);
  assert.equal(state.preview, undefined);
  assert.equal(state.selectedOrdinal, undefined);
  assert.deepEqual(state.candidates, []);
});

test('Feature 007 ViewModel announces each Add outcome and names pending work', () => {
  assert.equal(catalogIntakePendingMessage('discover'), 'Finding matches…');
  assert.equal(
    catalogIntakePendingMessage('select'),
    'Agent is gathering restaurant information…',
  );
  assert.equal(
    catalogIntakePendingMessage('confirm'),
    'Confirming and saving…',
  );

  const empty = reduceCatalogIntakeUi(catalogIntakeInitialState(), {
    type: 'discover_succeeded',
    output: discoverOutput([]),
  });
  assert.equal(empty.stage, 'empty');
  assert.match(catalogIntakeLiveMessage(empty), /No matches found/u);

  let candidates = reduceCatalogIntakeUi(catalogIntakeInitialState(), {
    type: 'discover_succeeded',
    output: discoverOutput([candidate()]),
  });
  assert.match(catalogIntakeLiveMessage(candidates), /1 possible match/u);

  candidates = reduceCatalogIntakeUi(candidates, { type: 'select_started' });
  assert.equal(candidates.stage, 'loading');
  assert.equal(candidates.previousStage, 'candidates');
  assert.equal(
    catalogIntakeLiveMessage(candidates),
    'Agent is gathering restaurant information…',
  );

  const clarification = reduceCatalogIntakeUi(candidates, {
    type: 'select_succeeded',
    output: {
      status: 'clarification_required',
      sessionId: 'session-feature-007',
      sessionVersion: 2,
      clarification: {
        code: 'ambiguous_location',
        prompt: 'Choose a branch or correct its location.',
        fields: ['area', 'address'],
      },
      expiresAt: '2026-09-24T12:30:00.000Z',
    },
  });
  assert.match(
    catalogIntakeLiveMessage(clarification),
    /Choose a branch or correct its location/u,
  );

  const preview = reduceCatalogIntakeUi(clarification, {
    type: 'select_succeeded',
    output: previewOutput(),
  });
  assert.match(catalogIntakeLiveMessage(preview), /Research incomplete/u);
  assert.match(
    catalogIntakeLiveMessage({
      ...preview,
      preview: {
        ...preview.preview,
        suspectedDuplicates: [
          {
            itemId: 'saved-shake-shack',
            title: 'シェイク シャック 新宿サザンテラス',
            match: 'strong',
            reason: 'same_listing',
          },
        ],
      },
    }),
    /already in your Atlas/u,
  );
  assert.match(
    catalogIntakeLiveMessage({
      ...preview,
      preview: { ...preview.preview, locationEvidence: { status: 'known' } },
    }),
    /Preview ready/u,
  );

  const dependencyError = reduceCatalogIntakeUi(preview, {
    type: 'confirm_succeeded',
    output: { status: 'failed_no_write', reason: 'provider_unavailable' },
  });
  assert.equal(dependencyError.stage, 'error');
  assert.match(catalogIntakeLiveMessage(dependencyError), /Nothing was saved/u);

  const conflict = reduceCatalogIntakeUi(preview, {
    type: 'confirm_succeeded',
    output: { status: 'conflict', newPreview: previewOutput().preview },
  });
  assert.match(catalogIntakeLiveMessage(conflict), /Evidence changed/u);

  const success = reduceCatalogIntakeUi(preview, {
    type: 'confirm_succeeded',
    output: {
      status: 'committed_needs_review',
      itemId: 'item-feature-007',
      receiptRef: 'receipt-feature-007',
      replayed: false,
    },
  });
  assert.match(
    catalogIntakeLiveMessage(success),
    /legacy save is not map-ready/u,
  );
});

function discoverOutput(candidates) {
  return {
    status: candidates.length ? 'candidates_ready' : 'clarification_required',
    sessionId: 'session-feature-007',
    sessionVersion: 1,
    candidates,
    hasMore: false,
    expiresAt: '2026-09-24T12:30:00.000Z',
  };
}

function candidate() {
  return {
    ordinal: 1,
    transientName: '讃岐うどん大使 東京麺通団',
    transientAddress: '東京都新宿区西新宿7丁目9-15',
    attribution: {
      label: 'Google Maps',
      url: 'https://maps.google.com/',
    },
  };
}

function previewOutput() {
  return {
    status: 'preview_ready',
    sessionId: 'session-feature-007',
    sessionVersion: 3,
    expiresAt: '2026-09-24T12:30:00.000Z',
    preview: {
      sessionId: 'session-feature-007',
      previewVersion: 3,
      state: 'preview_ready',
      candidateIdentity: {
        providerNamespace: 'google_places',
        placeId: 'place-feature-007',
      },
      ownerFields: {},
      titleProposal: {
        provenance: 'owner_query',
        value: '讃岐うどん大使 東京麺通団',
      },
      locationEvidence: { status: 'unknown' },
      tabelog: { status: 'unknown' },
      reservation: { status: 'unknown' },
      suspectedDuplicates: [],
      unknownFields: ['address', 'coordinates', 'tabelog', 'reservation'],
      warnings: [],
      evidenceDigest: 'a'.repeat(64),
      catalogRevision: 'catalog-feature-007',
      expiresAt: '2026-09-24T12:30:00.000Z',
    },
  };
}
