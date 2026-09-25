import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasApplication } from '../atlas-application.ts';
import {
  createCatalogIntakeModule,
  createCatalogIntakeOperationGroup,
  createInMemoryCatalogIntakeStatePort,
} from './catalog-intake-coordinator.ts';

const executionContext = {
  invocation: {
    ownerId: 'owner-1',
    channel: 'web',
    conversationId: 'browser-session-1',
  },
};

test('a selected restaurant with a durable geocoder no-match reaches preview and commits needs-review once', async () => {
  const clock = { now: () => new Date('2026-09-24T10:00:00.000Z') };
  const state = createInMemoryCatalogIntakeStatePort(clock);
  const publishCalls = [];
  const application = createAtlasApplication(
    createCatalogIntakeOperationGroup(
      createCatalogIntakeModule({
        discoveryPort: discoveryFixture(),
        durableGeocoderPort: {
          async propose() {
            return { ok: true, value: { status: 'no_match' } };
          },
        },
        atlasCatalogIntakePort: {
          async publish(preview, mutationKey, expectedSessionVersion) {
            publishCalls.push({ preview, mutationKey, expectedSessionVersion });
            const outcome = {
              status: 'committed_needs_review',
              itemId: 'candidate-1',
              receiptRef: 'receipt-1',
              replayed: false,
            };
            const stored = await state.get(
              executionContext.invocation,
              preview.sessionId,
            );
            assert.equal(stored.state, 'preview_ready');
            const committed = await state.compareAndSwap({
              scope: executionContext.invocation,
              sessionId: stored.sessionId,
              expectedVersion: expectedSessionVersion,
              next: {
                ...executionContext.invocation,
                sessionId: stored.sessionId,
                sessionVersion: expectedSessionVersion + 1,
                state: 'committed',
                committedFromVersion: expectedSessionVersion,
                requestToken: stored.requestToken,
                normalizedOwnerQuery: stored.normalizedOwnerQuery,
                terminalAt: clock.now().toISOString(),
                retainUntil: '2027-03-23T10:00:00.000Z',
                mutationKey,
                previewVersion: preview.previewVersion,
                evidenceDigest: preview.evidenceDigest,
                outcome,
              },
            });
            assert.equal(committed.kind, 'applied');
            return outcome;
          },
        },
        statePort: state,
        clock,
        idSource: { nextId: () => 'session-1' },
        catalogRevision: { read: async () => 'catalog-r1' },
      }),
    ),
  );

  const discovered = await application.execute(
    {
      key: 'catalog.intake.discover',
      input: {
        query: '讃岐うどん大使 東京麺通団',
        requestToken: 'browser-request-1',
      },
    },
    executionContext,
  );
  assert.equal(discovered.ok, true);

  const selected = await application.execute(
    {
      key: 'catalog.intake.select',
      input: {
        sessionId: 'session-1',
        expectedSessionVersion: 1,
        ordinal: 1,
        requestResearch: false,
      },
    },
    executionContext,
  );

  assert.equal(selected.ok, true);
  assert.equal(selected.value.status, 'preview_ready');
  assert.deepEqual(selected.value.preview.locationEvidence, {
    status: 'unknown',
  });
  assert.deepEqual(selected.value.preview.titleProposal, {
    provenance: 'owner_query',
    value: '讃岐うどん大使 東京麺通団',
  });
  assert.equal(
    selected.value.preview.warnings.some(({ code }) => code === 'needs_review'),
    true,
  );
  assert.equal(
    selected.value.preview.warnings.some(
      ({ code }) => code === 'provider_unavailable',
    ),
    false,
  );

  const previewDigest = selected.value.preview.evidenceDigest;
  const confirmed = await application.execute(
    {
      key: 'catalog.intake.confirm',
      input: {
        sessionId: 'session-1',
        expectedPreviewVersion: selected.value.preview.previewVersion,
      },
    },
    executionContext,
  );

  assert.deepEqual(confirmed, {
    ok: true,
    value: {
      status: 'committed_needs_review',
      itemId: 'candidate-1',
      receiptRef: 'receipt-1',
      replayed: false,
    },
  });
  assert.equal(publishCalls.length, 1);
  assert.equal(publishCalls[0].preview.evidenceDigest, previewDigest);

  const replayed = await application.execute(
    {
      key: 'catalog.intake.confirm',
      input: {
        sessionId: 'session-1',
        expectedPreviewVersion: selected.value.preview.previewVersion,
      },
    },
    executionContext,
  );
  assert.deepEqual(replayed, {
    ok: true,
    value: {
      status: 'committed_needs_review',
      itemId: 'candidate-1',
      receiptRef: 'receipt-1',
      replayed: true,
    },
  });
  assert.equal(publishCalls.length, 1);
});

test('confirm returns a changed durable-location preview without publishing', async () => {
  const clock = { now: () => new Date('2026-09-24T10:00:00.000Z') };
  const publishCalls = [];
  let geocoderCalls = 0;
  const application = createAtlasApplication(
    createCatalogIntakeOperationGroup(
      createCatalogIntakeModule({
        discoveryPort: discoveryFixture(),
        durableGeocoderPort: {
          async propose() {
            geocoderCalls += 1;
            return geocoderCalls === 1
              ? { ok: true, value: { status: 'no_match' } }
              : {
                  ok: true,
                  value: {
                    status: 'resolved',
                    normalizedAddress: '東京都新宿区西新宿7丁目9-15',
                    latitude: 35.6951,
                    longitude: 139.6974,
                    provider: 'fixture-osm-geocoder',
                    sourceUrl: 'https://www.openstreetmap.org/node/123',
                    license: 'ODbL-1.0',
                    checkedAt: '2026-09-24T10:00:00.000Z',
                  },
                };
          },
        },
        atlasCatalogIntakePort: {
          async publish(...args) {
            publishCalls.push(args);
            return {
              status: 'committed_verified',
              itemId: 'must-not-publish',
              receiptRef: 'must-not-publish',
              replayed: false,
            };
          },
        },
        statePort: createInMemoryCatalogIntakeStatePort(clock),
        clock,
        idSource: { nextId: () => 'session-1' },
        catalogRevision: { read: async () => 'catalog-r1' },
      }),
    ),
  );

  await application.execute(
    {
      key: 'catalog.intake.discover',
      input: {
        query: '讃岐うどん大使 東京麺通団',
        requestToken: 'browser-request-change',
      },
    },
    executionContext,
  );
  const selected = await application.execute(
    {
      key: 'catalog.intake.select',
      input: {
        sessionId: 'session-1',
        expectedSessionVersion: 1,
        ordinal: 1,
        requestResearch: false,
      },
    },
    executionContext,
  );
  assert.equal(selected.ok, true);
  assert.equal(selected.value.status, 'preview_ready');

  const confirmed = await application.execute(
    {
      key: 'catalog.intake.confirm',
      input: {
        sessionId: 'session-1',
        expectedPreviewVersion: selected.value.preview.previewVersion,
      },
    },
    executionContext,
  );

  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.value.status, 'conflict');
  assert.notEqual(
    confirmed.value.newPreview.evidenceDigest,
    selected.value.preview.evidenceDigest,
  );
  assert.equal(confirmed.value.newPreview.locationEvidence.status, 'known');
  assert.deepEqual(confirmed.value.newPreview.unknownFields, [
    'tabelog',
    'reservation',
  ]);
  assert.equal(publishCalls.length, 0);
});

test('confirm returns a closed dependency no-write when durable evidence refresh fails', async () => {
  const clock = { now: () => new Date('2026-09-24T10:00:00.000Z') };
  let geocoderCalls = 0;
  let publishCalls = 0;
  const application = createAtlasApplication(
    createCatalogIntakeOperationGroup(
      createCatalogIntakeModule({
        discoveryPort: discoveryFixture(),
        durableGeocoderPort: {
          async propose() {
            geocoderCalls += 1;
            return geocoderCalls === 1
              ? { ok: true, value: { status: 'no_match' } }
              : {
                  ok: false,
                  error: {
                    kind: 'dependency_failure',
                    message: 'private provider detail',
                  },
                };
          },
        },
        atlasCatalogIntakePort: {
          async publish() {
            publishCalls += 1;
            return {
              status: 'committed_needs_review',
              itemId: 'must-not-publish',
              receiptRef: 'must-not-publish',
              replayed: false,
            };
          },
        },
        statePort: createInMemoryCatalogIntakeStatePort(clock),
        clock,
        idSource: { nextId: () => 'session-1' },
        catalogRevision: { read: async () => 'catalog-r1' },
      }),
    ),
  );

  await application.execute(
    {
      key: 'catalog.intake.discover',
      input: {
        query: '讃岐うどん大使 東京麺通団',
        requestToken: 'browser-request-failure',
      },
    },
    executionContext,
  );
  const selected = await application.execute(
    {
      key: 'catalog.intake.select',
      input: {
        sessionId: 'session-1',
        expectedSessionVersion: 1,
        ordinal: 1,
        requestResearch: false,
      },
    },
    executionContext,
  );
  assert.equal(selected.ok, true);
  assert.equal(selected.value.status, 'preview_ready');

  const confirmed = await application.execute(
    {
      key: 'catalog.intake.confirm',
      input: {
        sessionId: 'session-1',
        expectedPreviewVersion: selected.value.preview.previewVersion,
      },
    },
    executionContext,
  );

  assert.deepEqual(confirmed, {
    ok: true,
    value: { status: 'failed_no_write', reason: 'dependency' },
  });
  assert.equal(publishCalls, 0);
  assert.doesNotMatch(JSON.stringify(confirmed), /private provider detail/u);
});

test('confirm turns a resolved-to-no-match evidence change into an unknown conflict preview', async () => {
  const clock = { now: () => new Date('2026-09-24T10:00:00.000Z') };
  let geocoderCalls = 0;
  let publishCalls = 0;
  const application = createAtlasApplication(
    createCatalogIntakeOperationGroup(
      createCatalogIntakeModule({
        discoveryPort: discoveryFixture(),
        durableGeocoderPort: {
          async propose() {
            geocoderCalls += 1;
            return geocoderCalls === 1
              ? {
                  ok: true,
                  value: {
                    status: 'resolved',
                    normalizedAddress: '東京都新宿区西新宿7丁目9-15',
                    latitude: 35.6951,
                    longitude: 139.6974,
                    provider: 'fixture-osm-geocoder',
                    sourceUrl: 'https://www.openstreetmap.org/node/123',
                    license: 'ODbL-1.0',
                    checkedAt: '2026-09-24T09:59:00.000Z',
                  },
                }
              : { ok: true, value: { status: 'no_match' } };
          },
        },
        atlasCatalogIntakePort: {
          async publish() {
            publishCalls += 1;
            return {
              status: 'committed_verified',
              itemId: 'must-not-publish',
              receiptRef: 'must-not-publish',
              replayed: false,
            };
          },
        },
        statePort: createInMemoryCatalogIntakeStatePort(clock),
        clock,
        idSource: { nextId: () => 'session-1' },
        catalogRevision: { read: async () => 'catalog-r1' },
      }),
    ),
  );

  await application.execute(
    {
      key: 'catalog.intake.discover',
      input: {
        query: '讃岐うどん大使 東京麺通団',
        requestToken: 'browser-request-lost-evidence',
      },
    },
    executionContext,
  );
  const selected = await application.execute(
    {
      key: 'catalog.intake.select',
      input: {
        sessionId: 'session-1',
        expectedSessionVersion: 1,
        ordinal: 1,
        requestResearch: false,
      },
    },
    executionContext,
  );
  assert.equal(selected.ok, true);
  assert.equal(selected.value.preview.locationEvidence.status, 'known');

  const confirmed = await application.execute(
    {
      key: 'catalog.intake.confirm',
      input: {
        sessionId: 'session-1',
        expectedPreviewVersion: selected.value.preview.previewVersion,
      },
    },
    executionContext,
  );

  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.value.status, 'conflict');
  assert.deepEqual(confirmed.value.newPreview.locationEvidence, {
    status: 'unknown',
  });
  assert.equal('addressProposal' in confirmed.value.newPreview, false);
  assert.deepEqual(confirmed.value.newPreview.unknownFields, [
    'address',
    'coordinates',
    'tabelog',
    'reservation',
  ]);
  assert.equal(publishCalls, 0);
});

function discoveryFixture() {
  const candidate = {
    durableIdentity: {
      providerNamespace: 'google-places',
      placeId: 'tokyo-mentsudan-place-id',
      ordinal: 1,
    },
    transientPresentation: {
      name: 'Tōkyō Mentsūdan',
      address:
        'Japan, 〒160-0023 Tokyo, Shinjuku City, Nishishinjuku, 7-chōme−9−１５',
      attribution: {
        label: 'Google Maps',
        url: 'https://maps.google.com/',
      },
    },
  };
  return {
    async discover() {
      return {
        ok: true,
        value: { candidates: [candidate], hasMore: false },
      };
    },
    async refetch() {
      return { ok: true, value: candidate };
    },
  };
}
