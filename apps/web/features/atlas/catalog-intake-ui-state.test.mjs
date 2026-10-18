import assert from 'node:assert/strict';
import test from 'node:test';

import {
  catalogIntakeInitialState,
  catalogIntakeErrorRecovery,
  catalogIntakeManualCompletionError,
  catalogIntakeManualLabels,
  reduceCatalogIntakeUi,
} from './catalog-intake-ui-state.ts';

test('manual completion validates coordinates and source-backed facts', () => {
  const base = catalogIntakeInitialState();
  assert.deepEqual(catalogIntakeManualLabels('焼鳥、 つくね, 焼き鳥'), [
    '焼鳥',
    'つくね',
    '焼き鳥',
  ]);
  assert.match(
    catalogIntakeManualCompletionError({ ...base, latitude: '35.68' }),
    /both coordinates/u,
  );
  assert.match(
    catalogIntakeManualCompletionError({
      ...base,
      address: 'Tokyo',
      latitude: '91',
      longitude: '139',
    }),
    /Latitude/u,
  );
  assert.match(
    catalogIntakeManualCompletionError({ ...base, tabelogScore: '3.5' }),
    /listing URL/u,
  );
  assert.equal(
    catalogIntakeManualCompletionError({
      ...base,
      address: 'Tokyo',
      latitude: '35.68',
      longitude: '139.7',
      tabelogScore: '3.5',
      tabelogUrl: 'https://tabelog.com/tokyo/A1304/A130401/12345678/',
    }),
    undefined,
  );
});

test('a changed manual detail requires a refreshed preview before publish', () => {
  let state = reduceCatalogIntakeUi(catalogIntakeInitialState(), {
    type: 'select_succeeded',
    output: previewOutput(),
  });
  state = reduceCatalogIntakeUi(state, {
    type: 'field_changed',
    field: 'address',
    value: '東京都渋谷区代々木2丁目2−1',
  });
  assert.equal(state.previewNeedsRefresh, true);
  assert.equal(state.preview?.previewVersion, 3);
  const refreshed = previewOutput();
  refreshed.preview.ownerFields = { address: state.address };
  state = reduceCatalogIntakeUi(state, {
    type: 'select_succeeded',
    output: refreshed,
  });
  assert.equal(state.previewNeedsRefresh, false);
  assert.equal(state.address, '東京都渋谷区代々木2丁目2−1');
});

test('catalog intake UI keeps owner input through loading, empty, and error retries', () => {
  let state = catalogIntakeInitialState();
  state = reduceCatalogIntakeUi(state, {
    type: 'field_changed',
    field: 'query',
    value: '鮨青空',
  });
  state = reduceCatalogIntakeUi(state, {
    type: 'discover_started',
    requestToken: 'request-1',
  });
  assert.equal(state.stage, 'loading');
  state = reduceCatalogIntakeUi(state, {
    type: 'discover_succeeded',
    output: {
      status: 'clarification_required',
      sessionId: 'session-1',
      sessionVersion: 1,
      candidates: [],
      hasMore: false,
      expiresAt: '2026-09-22T10:30:00.000Z',
    },
  });
  assert.equal(state.stage, 'empty');
  state = reduceCatalogIntakeUi(state, {
    type: 'request_failed',
    error: {
      code: 'unauthorized',
      message: 'Sign in as Owner to continue.',
      retryable: false,
    },
  });
  assert.equal(state.stage, 'error');
  assert.equal(state.query, '鮨青空');
  assert.equal(state.requestToken, 'request-1');
});

test('catalog intake UI traverses candidates, clarification, preview, conflict, expired, and success', () => {
  let state = reduceCatalogIntakeUi(catalogIntakeInitialState(), {
    type: 'discover_succeeded',
    output: {
      status: 'candidates_ready',
      sessionId: 'session-1',
      sessionVersion: 1,
      candidates: [
        {
          ordinal: 3,
          transientName: '鮨青空',
          transientAddress: '東京都中央区銀座',
          attribution: {
            label: 'Google Maps',
            url: 'https://maps.google.com/',
          },
        },
      ],
      hasMore: true,
      expiresAt: '2026-09-22T10:30:00.000Z',
    },
  });
  assert.equal(state.stage, 'candidates');
  assert.equal(state.selectedOrdinal, 3);

  state = reduceCatalogIntakeUi(state, {
    type: 'select_succeeded',
    output: {
      status: 'clarification_required',
      sessionId: 'session-1',
      sessionVersion: 2,
      clarification: {
        code: 'ambiguous_location',
        prompt: 'Add an area or address.',
        fields: ['area', 'address'],
      },
      expiresAt: '2026-09-22T10:31:00.000Z',
    },
  });
  assert.equal(state.stage, 'clarification');

  state = reduceCatalogIntakeUi(state, {
    type: 'select_succeeded',
    output: previewOutput(),
  });
  assert.equal(state.stage, 'preview');

  state = reduceCatalogIntakeUi(state, {
    type: 'confirm_succeeded',
    output: { status: 'conflict', newPreview: previewOutput().preview },
  });
  assert.equal(state.stage, 'conflict');

  state = reduceCatalogIntakeUi(state, {
    type: 'request_failed',
    error: { code: 'expired', message: 'Expired.' },
  });
  assert.equal(state.stage, 'expired');

  state = reduceCatalogIntakeUi(state, {
    type: 'confirm_succeeded',
    output: {
      status: 'committed_verified',
      itemId: 'item-1',
      receiptRef: 'receipt-1',
      replayed: false,
    },
  });
  assert.equal(state.stage, 'success');
});

test('catalog intake UI keeps the preview identity while confirm is loading', () => {
  let state = reduceCatalogIntakeUi(catalogIntakeInitialState(), {
    type: 'select_succeeded',
    output: previewOutput(),
  });

  state = reduceCatalogIntakeUi(state, { type: 'confirm_started' });

  assert.equal(state.stage, 'loading');
  assert.equal(state.previousStage, 'preview');
  assert.equal(state.lastOperation, 'confirm');
  assert.equal(state.preview?.previewVersion, 3);
});

function previewOutput() {
  return {
    status: 'preview_ready',
    sessionId: 'session-1',
    sessionVersion: 3,
    expiresAt: '2026-09-22T10:32:00.000Z',
    preview: {
      sessionId: 'session-1',
      previewVersion: 3,
      state: 'preview_ready',
      candidateIdentity: {
        providerNamespace: 'google_places',
        placeId: 'place-1',
      },
      ownerFields: {},
      titleProposal: { provenance: 'owner_query', value: '鮨青空' },
      addressProposal: {
        provenance: 'durable_geocoder_observed',
        value: '東京都中央区銀座',
        sourceUrl: 'https://www.openstreetmap.org/node/1',
        license: 'OpenStreetMap contributors, ODbL 1.0',
        checkedAt: '2026-09-22T10:00:00.000Z',
      },
      locationEvidence: { status: 'unknown' },
      tabelog: { status: 'unknown' },
      reservation: { status: 'unknown' },
      suspectedDuplicates: [],
      unknownFields: ['coordinates', 'tabelog', 'reservation'],
      warnings: [],
      evidenceDigest: 'a'.repeat(64),
      catalogRevision: 'revision-1',
      expiresAt: '2026-09-22T10:32:00.000Z',
    },
  };
}

test('Add recovery only suggests signing in for an authentication failure and preserves the selected branch', () => {
  const base = {
    ...catalogIntakeInitialState(),
    query: '青葉亭',
    searchArea: '盛岡',
    selectedOrdinal: 2,
    sessionId: 'synthetic-session',
    lastOperation: 'select',
  };
  for (const code of [
    'unauthorized',
    'forbidden',
    'dependency_failure',
    'unexpected_failure',
    'rate_limited',
    'invalid_input',
  ]) {
    const state = reduceCatalogIntakeUi(base, {
      type: 'request_failed',
      error: { code, message: 'Synthetic failure', retryable: true },
    });
    assert.equal(state.query, base.query);
    assert.equal(state.searchArea, base.searchArea);
    assert.equal(state.selectedOrdinal, 2);
    assert.equal(state.sessionId, base.sessionId);
    assert.equal(state.lastOperation, 'select');
    const recovery = catalogIntakeErrorRecovery(state.error);
    assert.equal(/Sign in as Owner/.test(recovery), code === 'unauthorized');
  }
});
