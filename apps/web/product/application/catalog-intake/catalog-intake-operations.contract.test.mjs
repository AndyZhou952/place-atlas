import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createAtlasApplication,
  defineOperationGroup,
} from '../atlas-application.ts';
import {
  createCatalogIntakeModule,
  createCatalogIntakeOperationGroup,
  createInMemoryCatalogIntakeStatePort,
  createUnavailableCatalogIntakeModule,
} from './catalog-intake-coordinator.ts';

const ownerConversation = {
  invocation: {
    ownerId: 'owner-1',
    channel: 'web',
    conversationId: 'conversation-1',
  },
};

test('AtlasApplication awaits rejected handlers and returns one sanitized failure', async () => {
  const application = createAtlasApplication(
    defineOperationGroup({
      'probe.reject': {
        descriptor: {
          key: 'probe.reject',
          resultKind: 'json',
          effect: 'read',
          validate: () => ({ ok: true, value: {} }),
        },
        async handle() {
          throw new Error('private handler text');
        },
      },
    }),
  );

  assert.deepEqual(
    await application.execute({ key: 'probe.reject', input: {} }),
    {
      ok: false,
      error: {
        kind: 'unexpected_failure',
        message: 'The application operation could not be completed.',
      },
    },
  );
});

test('the production-default intake module exposes all four operations but fails closed', async () => {
  const application = createAtlasApplication(
    createCatalogIntakeOperationGroup(createUnavailableCatalogIntakeModule()),
  );
  const operations = [
    {
      key: 'catalog.intake.discover',
      input: { query: '鮮 さいとう', requestToken: 'request-1' },
    },
    {
      key: 'catalog.intake.select',
      input: {
        sessionId: 'session-1',
        expectedSessionVersion: 1,
        ordinal: 1,
        requestResearch: false,
      },
    },
    {
      key: 'catalog.intake.confirm',
      input: { sessionId: 'session-1', expectedPreviewVersion: 1 },
    },
    {
      key: 'catalog.intake.cancel',
      input: { sessionId: 'session-1', expectedSessionVersion: 1 },
    },
  ];

  for (const operation of operations) {
    const result = await application.execute(operation, ownerConversation);
    assert.deepEqual(result, {
      ok: false,
      error: {
        code: 'dependency_failure',
        message: 'Catalog intake is not configured in this deployment.',
        retryable: true,
      },
    });
  }
});

test('catalog.intake.discover crosses AtlasApplication and returns only the closed transient candidate projection', async () => {
  const application = createFixtureApplication({
    async discover(input) {
      assert.deepEqual(input, { query: '鮨 さいとう' });
      return {
        ok: true,
        value: {
          candidates: [
            {
              durableIdentity: {
                providerNamespace: 'google-places',
                placeId: 'place-1',
                ordinal: 1,
              },
              transientPresentation: {
                name: '鮨 さいとう',
                address: '東京都港区六本木1-4-5',
                attribution: {
                  label: 'Google Maps',
                  url: 'https://maps.google.com/',
                },
              },
            },
          ],
          hasMore: false,
        },
      };
    },
  });

  const result = await application.execute({
    key: 'catalog.intake.discover',
    input: { query: '  鮨 さいとう  ', requestToken: 'request-1' },
  });

  assert.deepEqual(result, {
    ok: true,
    value: {
      status: 'candidates_ready',
      sessionId: 'session-1',
      sessionVersion: 1,
      candidates: [
        {
          ordinal: 1,
          transientName: '鮨 さいとう',
          transientAddress: '東京都港区六本木1-4-5',
          attribution: {
            label: 'Google Maps',
            url: 'https://maps.google.com/',
          },
        },
      ],
      hasMore: false,
      expiresAt: '2026-09-22T10:30:00.000Z',
    },
  });
});

test('catalog.intake.select returns a closed no-provider preview without persisting transient presentation', async () => {
  const application = createFixtureApplication(discoveryFixture());
  await application.execute({
    key: 'catalog.intake.discover',
    input: { query: '鮨 さいとう', requestToken: 'request-1' },
  });

  const result = await application.execute({
    key: 'catalog.intake.select',
    input: {
      sessionId: 'session-1',
      expectedSessionVersion: 1,
      ordinal: 1,
      ownerFields: {
        title: '鮨 さいとう',
        address: '東京都港区六本木1-4-5',
      },
      requestResearch: false,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'preview_ready');
  assert.equal(result.value.sessionVersion, 2);
  assert.deepEqual(Object.keys(result.value.preview).sort(), [
    'candidateIdentity',
    'catalogRevision',
    'evidenceDigest',
    'expiresAt',
    'locationEvidence',
    'ownerFields',
    'previewVersion',
    'reservation',
    'sessionId',
    'state',
    'suspectedDuplicates',
    'tabelog',
    'unknownFields',
    'warnings',
  ]);
  assert.deepEqual(result.value.preview.candidateIdentity, {
    providerNamespace: 'google-places',
    placeId: 'place-1',
  });
  assert.deepEqual(result.value.preview.ownerFields, {
    title: '鮨 さいとう',
    address: '東京都港区六本木1-4-5',
  });
  assert.deepEqual(result.value.preview.locationEvidence, {
    status: 'unknown',
  });
  assert.deepEqual(result.value.preview.tabelog, { status: 'unknown' });
  assert.deepEqual(result.value.preview.reservation, { status: 'unknown' });
  assert.deepEqual(result.value.preview.unknownFields, [
    'coordinates',
    'tabelog',
    'reservation',
  ]);
  assert.match(result.value.preview.evidenceDigest, /^[a-f0-9]{64}$/u);
  assert.doesNotMatch(
    JSON.stringify(result.value.preview),
    /Transient Google|Google Maps/u,
  );
});

test('only-name select uses durable geocoder evidence to create a closed proposal preview', async () => {
  const geocoderInputs = [];
  const application = createFixtureApplication({
    discoveryPort: discoveryFixture({
      transientName: 'GOOGLE TRANSIENT MUST NOT BECOME DURABLE',
    }),
    durableGeocoderPort: {
      async propose(input) {
        geocoderInputs.push(input);
        return {
          ok: true,
          value: {
            status: 'resolved',
            normalizedAddress: '東京都中央区銀座4丁目1-2',
            latitude: 35.6717,
            longitude: 139.765,
            provider: 'fixture-osm-geocoder',
            sourceUrl: 'https://www.openstreetmap.org/node/123',
            license: 'ODbL-1.0',
            checkedAt: '2026-09-22T10:00:00.000Z',
          },
        };
      },
    },
  });
  await application.execute({
    key: 'catalog.intake.discover',
    input: { query: '銀座 鮨青空', requestToken: 'request-only-name' },
  });

  const result = await application.execute({
    key: 'catalog.intake.select',
    input: {
      sessionId: 'session-1',
      expectedSessionVersion: 1,
      ordinal: 1,
      requestResearch: false,
    },
  });

  assert.deepEqual(geocoderInputs, [
    {
      trigger: 'owner_intake_select',
      dataClassification: 'public_place_query',
      ownerQuery: '銀座 鮨青空',
      ownerDraft: {},
    },
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'preview_ready');
  assert.deepEqual(result.value.preview.titleProposal, {
    provenance: 'owner_query',
    value: '銀座 鮨青空',
  });
  assert.deepEqual(result.value.preview.addressProposal, {
    provenance: 'durable_geocoder_observed',
    value: '東京都中央区銀座4丁目1-2',
    sourceUrl: 'https://www.openstreetmap.org/node/123',
    license: 'ODbL-1.0',
    checkedAt: '2026-09-22T10:00:00.000Z',
  });
  assert.deepEqual(result.value.preview.locationEvidence, {
    status: 'known',
    provenance: 'durable_geocoder_observed',
    normalizedAddress: '東京都中央区銀座4丁目1-2',
    latitude: 35.6717,
    longitude: 139.765,
    provider: 'fixture-osm-geocoder',
    sourceUrl: 'https://www.openstreetmap.org/node/123',
    license: 'ODbL-1.0',
    checkedAt: '2026-09-22T10:00:00.000Z',
  });
  assert.deepEqual(result.value.preview.unknownFields, [
    'tabelog',
    'reservation',
  ]);
  assert.doesNotMatch(
    JSON.stringify(result.value.preview),
    /GOOGLE TRANSIENT MUST NOT BECOME DURABLE/u,
  );
});

test('ambiguous durable location asks for area or address without using Google transient facts', async () => {
  const application = createFixtureApplication({
    discoveryPort: discoveryFixture({
      transientName: 'GOOGLE TRANSIENT MUST NOT BECOME A TITLE',
    }),
    durableGeocoderPort: {
      async propose() {
        return { ok: true, value: { status: 'ambiguous' } };
      },
    },
  });
  await application.execute({
    key: 'catalog.intake.discover',
    input: { query: '鮨青空', requestToken: 'request-ambiguous' },
  });

  const result = await application.execute({
    key: 'catalog.intake.select',
    input: {
      sessionId: 'session-1',
      expectedSessionVersion: 1,
      ordinal: 1,
      requestResearch: false,
    },
  });

  assert.deepEqual(result, {
    ok: true,
    value: {
      status: 'clarification_required',
      sessionId: 'session-1',
      sessionVersion: 2,
      clarification: {
        code: 'ambiguous_location',
        prompt: 'Add an area or address to identify the right place.',
        fields: ['area', 'address'],
      },
      expiresAt: '2026-09-22T10:30:00.000Z',
    },
  });
  assert.doesNotMatch(JSON.stringify(result), /GOOGLE TRANSIENT/u);
});

test('unavailable durable geocoder keeps the owner query in a needs-review preview', async () => {
  const application = createFixtureApplication({
    discoveryPort: discoveryFixture(),
    durableGeocoderPort: {
      async propose() {
        return {
          ok: false,
          error: {
            kind: 'dependency_failure',
            message: 'private provider failure',
          },
        };
      },
    },
  });
  await application.execute({
    key: 'catalog.intake.discover',
    input: { query: '鮨青空', requestToken: 'request-unavailable-geocoder' },
  });

  const result = await application.execute({
    key: 'catalog.intake.select',
    input: {
      sessionId: 'session-1',
      expectedSessionVersion: 1,
      ordinal: 1,
      requestResearch: false,
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'preview_ready');
  assert.deepEqual(result.value.preview.ownerFields, {});
  assert.deepEqual(result.value.preview.titleProposal, {
    provenance: 'owner_query',
    value: '鮨青空',
  });
  assert.equal('addressProposal' in result.value.preview, false);
  assert.deepEqual(result.value.preview.locationEvidence, {
    status: 'unknown',
  });
  assert.deepEqual(result.value.preview.unknownFields, [
    'address',
    'coordinates',
    'tabelog',
    'reservation',
  ]);
  assert.deepEqual(result.value.preview.warnings, [
    {
      code: 'provider_unavailable',
      message:
        'Durable location lookup is unavailable; review the owner-provided details.',
    },
    {
      code: 'needs_review',
      message:
        'Confirm or complete the durable place details before publishing.',
    },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /private provider failure/u);
});

test('catalog.intake.confirm stays fail-closed and performs no Catalog publication in the T-12 skeleton', async () => {
  const application = createFixtureApplication(discoveryFixture());
  await discoverAndSelect(application);

  assert.deepEqual(
    await application.execute({
      key: 'catalog.intake.confirm',
      input: { sessionId: 'session-1', expectedPreviewVersion: 1 },
    }),
    {
      ok: true,
      value: { status: 'failed_no_write', reason: 'dependency' },
    },
  );
});

test('catalog.intake.confirm derives a server mutation key and publishes one verified result through Atlas Catalog', async () => {
  const publications = [];
  const application = createFixtureApplication({
    discoveryPort: discoveryFixture(),
    atlasCatalogIntakePort: {
      async publish(
        preview,
        mutationKey,
        expectedSessionVersion,
        catalogRevision,
      ) {
        publications.push({
          preview,
          mutationKey,
          expectedSessionVersion,
          catalogRevision,
        });
        return {
          status: 'committed_verified',
          itemId: 'atlas-item-1',
          receiptRef: 'catalog-receipt-1',
          replayed: false,
        };
      },
    },
  });
  await discoverAndSelect(application, {
    coordinates: { latitude: 35.6654, longitude: 139.7298 },
  });

  const result = await application.execute({
    key: 'catalog.intake.confirm',
    input: { sessionId: 'session-1', expectedPreviewVersion: 1 },
  });

  assert.deepEqual(result, {
    ok: true,
    value: {
      status: 'committed_verified',
      itemId: 'atlas-item-1',
      receiptRef: 'catalog-receipt-1',
      replayed: false,
    },
  });
  assert.equal(publications.length, 1);
  assert.deepEqual(
    {
      expectedSessionVersion: publications[0].expectedSessionVersion,
      catalogRevision: publications[0].catalogRevision,
    },
    { expectedSessionVersion: 3, catalogRevision: 'catalog-r1' },
  );
  assert.match(publications[0].mutationKey, /^[a-f0-9]{64}$/u);
  assert.deepEqual(publications[0].preview.candidateIdentity, {
    providerNamespace: 'google-places',
    placeId: 'place-1',
  });
});

test('catalog.intake.confirm turns confirm-time strong identity drift into a new preview conflict without publishing', async () => {
  const base = discoveryFixture();
  let refetchCalls = 0;
  let publishCalls = 0;
  const application = createFixtureApplication({
    discoveryPort: {
      discover: (input) => base.discover(input),
      async refetch(input) {
        refetchCalls += 1;
        if (refetchCalls === 1) return base.refetch(input);
        return {
          ok: true,
          value: {
            ...discoveryCandidate(),
            durableIdentity: {
              providerNamespace: 'google-places',
              placeId: 'place-confirm-refresh',
              ordinal: 1,
            },
          },
        };
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
  });
  await discoverAndSelect(application, {
    coordinates: { latitude: 35.6654, longitude: 139.7298 },
  });

  const result = await application.execute({
    key: 'catalog.intake.confirm',
    input: { sessionId: 'session-1', expectedPreviewVersion: 1 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'conflict');
  assert.equal(result.value.newPreview.previewVersion, 2);
  assert.deepEqual(result.value.newPreview.candidateIdentity, {
    providerNamespace: 'google-places',
    placeId: 'place-confirm-refresh',
  });
  assert.notEqual(result.value.newPreview.evidenceDigest, 'b'.repeat(64));
  assert.equal(publishCalls, 0);
});

test('catalog.intake.confirm returns a new preview when fixture Web research changes authoritative evidence', async () => {
  let publishCalls = 0;
  const application = createFixtureApplication({
    discoveryPort: discoveryFixture(),
    webResearchPort: {
      async research(input) {
        assert.equal(input.phase, 'confirm');
        return {
          ok: true,
          value: {
            tabelog: {
              status: 'known',
              score: 4.31,
              reviewCount: 140,
              url: 'https://tabelog.com/tokyo/A1307/A130701/13000001/',
              provenance: 'agent_observed',
              observedAt: '2026-09-22T10:00:00.000Z',
              freshness: 'fresh',
            },
            reservation: input.preview.reservation,
          },
        };
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
  });
  await discoverAndSelect(application, {
    coordinates: { latitude: 35.6654, longitude: 139.7298 },
  });

  const result = await application.execute({
    key: 'catalog.intake.confirm',
    input: { sessionId: 'session-1', expectedPreviewVersion: 1 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'conflict');
  assert.equal(result.value.newPreview.previewVersion, 2);
  assert.equal(result.value.newPreview.tabelog.status, 'known');
  assert.equal(result.value.newPreview.tabelog.provenance, 'agent_observed');
  assert.equal(result.value.newPreview.tabelog.score, 4.31);
  assert.equal(publishCalls, 0);
  const stableRetry = await application.execute({
    key: 'catalog.intake.confirm',
    input: { sessionId: 'session-1', expectedPreviewVersion: 2 },
  });
  assert.equal(stableRetry.ok, true);
  assert.equal(stableRetry.value.status, 'committed_verified');
  assert.equal(publishCalls, 1);
});

test('catalog.intake.confirm rejects expanded Web research output without persisting or publishing it', async () => {
  const state = recordingStatePort();
  let publishCalls = 0;
  const application = createFixtureApplication({
    discoveryPort: discoveryFixture(),
    statePort: state.port,
    webResearchPort: {
      async research(input) {
        return {
          ok: true,
          value: {
            tabelog: {
              ...input.preview.tabelog,
              rawHtml: '<article>private review text</article>',
            },
            reservation: input.preview.reservation,
          },
        };
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
  });
  await discoverAndSelect(application, {
    coordinates: { latitude: 35.6654, longitude: 139.7298 },
  });
  const before = structuredClone(state.sessions.get('session-1'));

  const result = await application.execute({
    key: 'catalog.intake.confirm',
    input: { sessionId: 'session-1', expectedPreviewVersion: 1 },
  });

  assert.deepEqual(result, {
    ok: true,
    value: { status: 'failed_no_write', reason: 'dependency' },
  });
  assert.equal(publishCalls, 0);
  assert.deepEqual(state.sessions.get('session-1'), before);
  assert.doesNotMatch(
    JSON.stringify(state.sessions.get('session-1')),
    /rawHtml|private review text/u,
  );
});

test('catalog.intake.confirm rejects illegal Web research URL, time, range, provenance, and freshness fields', async () => {
  const validTabelog = {
    status: 'known',
    score: 4.31,
    reviewCount: 140,
    url: 'https://tabelog.com/tokyo/A1307/A130701/13000001/',
    provenance: 'agent_observed',
    observedAt: '2026-09-22T09:55:00.000Z',
    freshness: 'fresh',
  };
  const maliciousOutputs = [
    { ...validTabelog, reviewText: 'private copied review' },
    { ...validTabelog, url: 'http://tabelog.com/tokyo/A1307/A130701/1/' },
    { ...validTabelog, observedAt: 'yesterday' },
    { ...validTabelog, score: 5.01 },
    { ...validTabelog, provenance: 'untrusted_scrape' },
    { ...validTabelog, freshness: 'forever' },
  ];

  for (const tabelog of maliciousOutputs) {
    const state = recordingStatePort();
    let publishCalls = 0;
    const application = createFixtureApplication({
      discoveryPort: discoveryFixture(),
      statePort: state.port,
      webResearchPort: {
        async research(input) {
          return {
            ok: true,
            value: { tabelog, reservation: input.preview.reservation },
          };
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
    });
    await discoverAndSelect(application, {
      coordinates: { latitude: 35.6654, longitude: 139.7298 },
    });
    const before = structuredClone(state.sessions.get('session-1'));

    assert.deepEqual(
      await application.execute({
        key: 'catalog.intake.confirm',
        input: { sessionId: 'session-1', expectedPreviewVersion: 1 },
      }),
      {
        ok: true,
        value: { status: 'failed_no_write', reason: 'dependency' },
      },
    );
    assert.equal(publishCalls, 0);
    assert.deepEqual(state.sessions.get('session-1'), before);
  }
});

test('catalog.intake.confirm refreshes durable geocoder evidence and conflicts instead of publishing changed coordinates', async () => {
  let geocoderCalls = 0;
  let publishCalls = 0;
  const application = createFixtureApplication({
    discoveryPort: discoveryFixture(),
    durableGeocoderPort: {
      async propose(input) {
        geocoderCalls += 1;
        assert.equal(
          input.trigger,
          geocoderCalls === 1 ? 'owner_intake_select' : 'owner_intake_confirm',
        );
        return {
          ok: true,
          value: {
            status: 'resolved',
            normalizedAddress:
              geocoderCalls === 1
                ? '東京都中央区銀座4丁目1-2'
                : '東京都中央区銀座4丁目1-3',
            latitude: geocoderCalls === 1 ? 35.6717 : 35.6718,
            longitude: 139.765,
            provider: 'fixture-osm-geocoder',
            sourceUrl: 'https://www.openstreetmap.org/node/123',
            license: 'ODbL-1.0',
            checkedAt:
              geocoderCalls === 1
                ? '2026-09-22T09:59:00.000Z'
                : '2026-09-22T10:00:00.000Z',
          },
        };
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
  });
  await application.execute({
    key: 'catalog.intake.discover',
    input: { query: '銀座 鮨青空', requestToken: 'request-geocoder-refresh' },
  });
  await application.execute({
    key: 'catalog.intake.select',
    input: {
      sessionId: 'session-1',
      expectedSessionVersion: 1,
      ordinal: 1,
      requestResearch: false,
    },
  });

  const result = await application.execute({
    key: 'catalog.intake.confirm',
    input: { sessionId: 'session-1', expectedPreviewVersion: 1 },
  });

  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'conflict');
  assert.equal(result.value.newPreview.previewVersion, 2);
  assert.equal(
    result.value.newPreview.locationEvidence.normalizedAddress,
    '東京都中央区銀座4丁目1-3',
  );
  assert.equal(result.value.newPreview.locationEvidence.latitude, 35.6718);
  assert.equal(geocoderCalls, 2);
  assert.equal(publishCalls, 0);
  const stableRetry = await application.execute({
    key: 'catalog.intake.confirm',
    input: { sessionId: 'session-1', expectedPreviewVersion: 2 },
  });
  assert.equal(stableRetry.ok, true);
  assert.equal(stableRetry.value.status, 'committed_verified');
  assert.equal(geocoderCalls, 3);
  assert.equal(publishCalls, 1);
});

test('catalog.intake.confirm retries enabled geocoding for unknown evidence and turns provider failure into one stable conflict preview', async () => {
  let geocoderCalls = 0;
  let publishCalls = 0;
  const application = createFixtureApplication({
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
                message: 'private geocoder outage',
              },
            };
      },
    },
    atlasCatalogIntakePort: {
      async publish() {
        publishCalls += 1;
        return {
          status: 'committed_needs_review',
          itemId: 'atlas-review-candidate-1',
          receiptRef: 'receipt-1',
          replayed: false,
        };
      },
    },
  });
  await application.execute({
    key: 'catalog.intake.discover',
    input: { query: '銀座 鮨青空', requestToken: 'request-geocoder-unknown' },
  });
  await application.execute({
    key: 'catalog.intake.select',
    input: {
      sessionId: 'session-1',
      expectedSessionVersion: 1,
      ordinal: 1,
      ownerFields: { title: '鮨青空' },
      requestResearch: false,
    },
  });

  const failedRefresh = await application.execute({
    key: 'catalog.intake.confirm',
    input: { sessionId: 'session-1', expectedPreviewVersion: 1 },
  });
  assert.equal(failedRefresh.ok, true);
  assert.equal(failedRefresh.value.status, 'conflict');
  assert.equal(failedRefresh.value.newPreview.previewVersion, 2);
  assert.deepEqual(failedRefresh.value.newPreview.locationEvidence, {
    status: 'unknown',
  });
  assert.deepEqual(failedRefresh.value.newPreview.warnings, [
    {
      code: 'provider_unavailable',
      message:
        'One or more enabled evidence providers could not be refreshed; retained evidence is stale or unknown.',
    },
    {
      code: 'needs_review',
      message:
        'Confirm or complete the durable place details before publishing.',
    },
  ]);
  assert.equal(publishCalls, 0);

  const stableRetry = await application.execute({
    key: 'catalog.intake.confirm',
    input: { sessionId: 'session-1', expectedPreviewVersion: 2 },
  });
  assert.equal(stableRetry.ok, true);
  assert.equal(stableRetry.value.status, 'committed_needs_review');
  assert.equal(geocoderCalls, 3);
  assert.equal(publishCalls, 1);
  assert.doesNotMatch(
    JSON.stringify(failedRefresh),
    /private geocoder outage/u,
  );
});

test('catalog.intake.confirm terminates when geocoding fails while Web research succeeds', async () => {
  let geocoderCalls = 0;
  let researchCalls = 0;
  let publishCalls = 0;
  const application = createFixtureApplication({
    discoveryPort: discoveryFixture(),
    durableGeocoderPort: {
      async propose() {
        geocoderCalls += 1;
        return geocoderCalls === 1
          ? { ok: true, value: { status: 'no_match' } }
          : {
              ok: false,
              error: { kind: 'dependency_failure', message: 'private outage' },
            };
      },
    },
    webResearchPort: {
      async research({ preview }) {
        researchCalls += 1;
        return {
          ok: true,
          value: {
            tabelog: preview.tabelog,
            reservation: preview.reservation,
          },
        };
      },
    },
    atlasCatalogIntakePort: {
      async publish() {
        publishCalls += 1;
        return {
          status: 'committed_needs_review',
          itemId: 'review-one',
          receiptRef: 'receipt-one',
          replayed: false,
        };
      },
    },
  });
  await application.execute({
    key: 'catalog.intake.discover',
    input: { query: '銀座 鮨青空', requestToken: 'dual-provider-one' },
  });
  await application.execute({
    key: 'catalog.intake.select',
    input: {
      sessionId: 'session-1',
      expectedSessionVersion: 1,
      ordinal: 1,
      ownerFields: { title: '鮨青空' },
      requestResearch: false,
    },
  });

  const refreshed = await application.execute({
    key: 'catalog.intake.confirm',
    input: { sessionId: 'session-1', expectedPreviewVersion: 1 },
  });
  assert.equal(refreshed.ok && refreshed.value.status, 'conflict');
  const committed = await application.execute({
    key: 'catalog.intake.confirm',
    input: { sessionId: 'session-1', expectedPreviewVersion: 2 },
  });

  assert.equal(
    committed.ok && committed.value.status,
    'committed_needs_review',
  );
  assert.equal(geocoderCalls, 3);
  assert.equal(researchCalls, 2);
  assert.equal(publishCalls, 1);
});

test('catalog.intake.confirm terminates when geocoding succeeds while Web research fails without changing observation time', async () => {
  let geocoderCalls = 0;
  let researchCalls = 0;
  let publishCalls = 0;
  const observedAt = '2026-09-22T09:55:00.000Z';
  const application = createFixtureApplication({
    discoveryPort: discoveryFixture(),
    durableGeocoderPort: {
      async propose() {
        geocoderCalls += 1;
        return {
          ok: true,
          value: {
            status: 'resolved',
            normalizedAddress: '東京都中央区銀座4丁目1-2',
            latitude: 35.6717,
            longitude: 139.765,
            provider: 'fixture-osm-geocoder',
            sourceUrl: 'https://www.openstreetmap.org/node/123',
            license: 'ODbL-1.0',
            checkedAt: '2026-09-22T09:59:00.000Z',
          },
        };
      },
    },
    webResearchPort: {
      async research({ preview }) {
        researchCalls += 1;
        return researchCalls === 1
          ? {
              ok: true,
              value: {
                tabelog: {
                  status: 'known',
                  score: 4.31,
                  url: 'https://tabelog.com/tokyo/A1307/A130701/13000001/',
                  provenance: 'agent_observed',
                  observedAt,
                  freshness: 'fresh',
                },
                reservation: preview.reservation,
              },
            }
          : {
              ok: false,
              error: { kind: 'dependency_failure', message: 'private outage' },
            };
      },
    },
    atlasCatalogIntakePort: {
      async publish() {
        publishCalls += 1;
        return {
          status: 'committed_verified',
          itemId: 'verified-one',
          receiptRef: 'receipt-one',
          replayed: false,
        };
      },
    },
  });
  await application.execute({
    key: 'catalog.intake.discover',
    input: { query: '銀座 鮨青空', requestToken: 'dual-provider-two' },
  });
  await application.execute({
    key: 'catalog.intake.select',
    input: {
      sessionId: 'session-1',
      expectedSessionVersion: 1,
      ordinal: 1,
      requestResearch: false,
    },
  });
  const researched = await application.execute({
    key: 'catalog.intake.confirm',
    input: { sessionId: 'session-1', expectedPreviewVersion: 1 },
  });
  assert.equal(researched.ok && researched.value.status, 'conflict');
  const failedRefresh = await application.execute({
    key: 'catalog.intake.confirm',
    input: { sessionId: 'session-1', expectedPreviewVersion: 2 },
  });
  assert.equal(failedRefresh.ok && failedRefresh.value.status, 'conflict');
  assert.equal(failedRefresh.value.newPreview.tabelog.freshness, 'stale');
  assert.equal(failedRefresh.value.newPreview.tabelog.observedAt, observedAt);

  const committed = await application.execute({
    key: 'catalog.intake.confirm',
    input: { sessionId: 'session-1', expectedPreviewVersion: 3 },
  });

  assert.equal(committed.ok && committed.value.status, 'committed_verified');
  assert.equal(geocoderCalls, 4);
  assert.equal(researchCalls, 3);
  assert.equal(publishCalls, 1);
});

test('catalog.intake.confirm makes failed Web research evidence stale once without changing its observation time', async () => {
  let researchCalls = 0;
  let publishCalls = 0;
  const observedAt = '2026-09-22T09:55:00.000Z';
  const application = createFixtureApplication({
    discoveryPort: discoveryFixture(),
    webResearchPort: {
      async research(input) {
        researchCalls += 1;
        if (researchCalls === 1) {
          return {
            ok: true,
            value: {
              tabelog: {
                status: 'known',
                score: 4.31,
                url: 'https://tabelog.com/tokyo/A1307/A130701/13000001/',
                provenance: 'agent_observed',
                observedAt,
                freshness: 'fresh',
              },
              reservation: input.preview.reservation,
            },
          };
        }
        return {
          ok: false,
          error: {
            kind: 'dependency_failure',
            message: 'private research outage',
          },
        };
      },
    },
    atlasCatalogIntakePort: {
      async publish() {
        publishCalls += 1;
        return {
          status: 'committed_verified',
          itemId: 'atlas-item-1',
          receiptRef: 'receipt-1',
          replayed: false,
        };
      },
    },
  });
  await discoverAndSelect(application, {
    coordinates: { latitude: 35.6654, longitude: 139.7298 },
  });
  const researched = await application.execute({
    key: 'catalog.intake.confirm',
    input: { sessionId: 'session-1', expectedPreviewVersion: 1 },
  });
  assert.equal(researched.value.status, 'conflict');

  const failedRefresh = await application.execute({
    key: 'catalog.intake.confirm',
    input: { sessionId: 'session-1', expectedPreviewVersion: 2 },
  });
  assert.equal(failedRefresh.ok, true);
  assert.equal(failedRefresh.value.status, 'conflict');
  assert.equal(failedRefresh.value.newPreview.previewVersion, 3);
  assert.equal(failedRefresh.value.newPreview.tabelog.freshness, 'stale');
  assert.equal(failedRefresh.value.newPreview.tabelog.observedAt, observedAt);
  assert.equal(publishCalls, 0);

  const stableRetry = await application.execute({
    key: 'catalog.intake.confirm',
    input: { sessionId: 'session-1', expectedPreviewVersion: 3 },
  });
  assert.equal(stableRetry.ok, true);
  assert.equal(stableRetry.value.status, 'committed_verified');
  assert.equal(researchCalls, 3);
  assert.equal(publishCalls, 1);
  assert.doesNotMatch(
    JSON.stringify(failedRefresh),
    /private research outage/u,
  );
});

test('catalog.intake.cancel returns one stable closed result and replays it', async () => {
  const application = createFixtureApplication(discoveryFixture());
  await application.execute({
    key: 'catalog.intake.discover',
    input: { query: '鮨 さいとう', requestToken: 'request-1' },
  });
  const operation = {
    key: 'catalog.intake.cancel',
    input: { sessionId: 'session-1', expectedSessionVersion: 1 },
  };

  assert.deepEqual(await application.execute(operation), {
    ok: true,
    value: { status: 'cancelled', sessionId: 'session-1', replayed: false },
  });
  assert.deepEqual(await application.execute(operation), {
    ok: true,
    value: { status: 'cancelled', sessionId: 'session-1', replayed: true },
  });
});

test('catalog.intake session expires at the exact 30 minute inactivity boundary', async () => {
  let now = new Date('2026-09-22T10:00:00.000Z');
  const application = createFixtureApplication({
    discoveryPort: discoveryFixture(),
    clock: { now: () => now },
  });
  await application.execute({
    key: 'catalog.intake.discover',
    input: { query: '鮨 さいとう', requestToken: 'request-expiry' },
  });

  now = new Date('2026-09-22T10:30:00.000Z');
  const result = await application.execute({
    key: 'catalog.intake.select',
    input: {
      sessionId: 'session-1',
      expectedSessionVersion: 1,
      ordinal: 1,
      ownerFields: { title: '鮨 さいとう' },
      requestResearch: false,
    },
  });

  assertClosedAddFailure(result, 'expired');
});

test('discover retry also expires at the exact 30 minute inactivity boundary', async () => {
  let now = new Date('2026-09-22T10:00:00.000Z');
  let refetchCalls = 0;
  const base = discoveryFixture();
  const application = createFixtureApplication({
    discoveryPort: {
      discover: (input) => base.discover(input),
      async refetch(input) {
        refetchCalls += 1;
        return base.refetch(input);
      },
    },
    clock: { now: () => now },
  });
  const operation = {
    key: 'catalog.intake.discover',
    input: { query: '鮨 さいとう', requestToken: 'request-expiry-retry' },
  };
  assert.equal((await application.execute(operation)).ok, true);

  now = new Date('2026-09-22T10:30:00.000Z');
  assertClosedAddFailure(await application.execute(operation), 'expired');
  assert.equal(refetchCalls, 0);
});

test('expiration CAS resolves renewed, expired, and cancelled concurrent state without false expiry', async () => {
  for (const race of ['renewed', 'expired', 'cancelled']) {
    let now = new Date('2026-09-22T10:00:00.000Z');
    const base = createInMemoryCatalogIntakeStatePort();
    const application = createFixtureApplication({
      discoveryPort: discoveryFixture(),
      statePort: expirationRacePort(base, race),
      clock: { now: () => now },
    });
    await application.execute({
      key: 'catalog.intake.discover',
      input: { query: '銀座 鮨', requestToken: `request-${race}` },
    });
    now = new Date('2026-09-22T10:30:00.000Z');

    const result = await application.execute(
      race === 'cancelled'
        ? {
            key: 'catalog.intake.cancel',
            input: { sessionId: 'session-1', expectedSessionVersion: 1 },
          }
        : {
            key: 'catalog.intake.select',
            input: {
              sessionId: 'session-1',
              expectedSessionVersion: 1,
              ordinal: 1,
              ownerFields: { title: '銀座 鮨' },
              requestResearch: false,
            },
          },
    );

    if (race === 'renewed') assertClosedAddFailure(result, 'conflict');
    if (race === 'expired') assertClosedAddFailure(result, 'expired');
    if (race === 'cancelled') {
      assert.deepEqual(result, {
        ok: true,
        value: { status: 'cancelled', sessionId: 'session-1', replayed: true },
      });
    }
  }
});

test('discover retry reuses its immutable candidate mapping and a new discover replaces the active conversation session', async () => {
  let nextId = 0;
  let discoverCalls = 0;
  let refetchCalls = 0;
  const base = discoveryFixture();
  const application = createFixtureApplication({
    discoveryPort: {
      async discover(input) {
        discoverCalls += 1;
        return base.discover(input);
      },
      async refetch(input) {
        refetchCalls += 1;
        return base.refetch(input);
      },
    },
    idSource: { nextId: () => `session-${++nextId}` },
  });
  const first = {
    key: 'catalog.intake.discover',
    input: { query: '銀座 鮨', requestToken: 'request-1' },
  };

  const created = await application.execute(first);
  const replayed = await application.execute(first);
  assert.deepEqual(replayed, created);
  assert.equal(discoverCalls, 1);
  assert.equal(refetchCalls, 1);

  const conflictingToken = await application.execute({
    ...first,
    input: { query: 'Ginza sushi', requestToken: 'request-1' },
  });
  assertClosedAddFailure(conflictingToken, 'conflict');

  const replacement = await application.execute({
    key: 'catalog.intake.discover',
    input: { query: 'Ginza sushi', requestToken: 'request-2' },
  });
  assert.equal(replacement.ok, true);
  assert.equal(replacement.value.sessionId, 'session-2');
  const oldSession = await application.execute({
    key: 'catalog.intake.select',
    input: {
      sessionId: 'session-1',
      expectedSessionVersion: 1,
      ordinal: 1,
      ownerFields: { title: '銀座 鮨' },
      requestResearch: false,
    },
  });
  assertClosedAddFailure(oldSession, 'conflict');
});

test('select accepted activity renews inactivity TTL and same-version retry is stable while changed payload conflicts', async () => {
  let now = new Date('2026-09-22T10:00:00.000Z');
  let refetchCalls = 0;
  const base = discoveryFixture();
  const application = createFixtureApplication({
    discoveryPort: {
      discover: (input) => base.discover(input),
      async refetch(input) {
        refetchCalls += 1;
        return base.refetch(input);
      },
    },
    clock: { now: () => now },
  });
  await application.execute({
    key: 'catalog.intake.discover',
    input: { query: '銀座 鮨', requestToken: 'request-select-retry' },
  });
  now = new Date('2026-09-22T10:29:59.000Z');
  const operation = {
    key: 'catalog.intake.select',
    input: {
      sessionId: 'session-1',
      expectedSessionVersion: 1,
      ordinal: 1,
      ownerFields: { title: '銀座 鮨' },
      requestResearch: false,
    },
  };
  const selected = await application.execute(operation);
  assert.equal(selected.ok, true);
  assert.equal(selected.value.expiresAt, '2026-09-22T10:59:59.000Z');
  assert.deepEqual(await application.execute(operation), selected);
  assert.equal(refetchCalls, 1);

  const conflict = await application.execute({
    ...operation,
    input: {
      ...operation.input,
      ownerFields: { title: 'Different owner draft' },
    },
  });
  assertClosedAddFailure(conflict, 'conflict');
});

test('catalog intake sessions are isolated by owner, channel, and conversation', async () => {
  const application = createFixtureApplication(discoveryFixture());
  await application.execute({
    key: 'catalog.intake.discover',
    input: { query: '銀座 鮨', requestToken: 'request-scope' },
  });

  for (const invocation of [
    { ownerId: 'owner-2', channel: 'web', conversationId: 'conversation-1' },
    { ownerId: 'owner-1', channel: 'wechat', conversationId: 'conversation-1' },
    { ownerId: 'owner-1', channel: 'web', conversationId: 'conversation-2' },
  ]) {
    const result = await application.execute(
      {
        key: 'catalog.intake.cancel',
        input: { sessionId: 'session-1', expectedSessionVersion: 1 },
      },
      { invocation },
    );
    assertClosedAddFailure(result, 'not_found');
  }
});

test('state cleanup expires active sessions and keeps only a minimal terminal reference', async () => {
  const state = createInMemoryCatalogIntakeStatePort();
  const application = createFixtureApplication({
    discoveryPort: discoveryFixture(),
    statePort: state,
  });
  await application.execute({
    key: 'catalog.intake.discover',
    input: { query: '銀座 鮨', requestToken: 'request-cleanup' },
  });

  assert.deepEqual(await state.cleanup(new Date('2026-09-23T10:30:00.000Z')), {
    expired: 1,
    removed: 0,
  });
  const terminal = await state.get(ownerConversation.invocation, 'session-1');
  assert.equal(terminal.state, 'expired');
  assert.equal('candidates' in terminal, false);
  assert.equal('preview' in terminal, false);
  assert.equal(JSON.stringify(terminal).includes('Transient Google'), false);
});

test('port rejections become closed AddError results without leaking raw details or performing later writes', async () => {
  for (const stage of [
    'discovery',
    'catalogRevision',
    'create',
    'get',
    'replace',
  ]) {
    const state = recordingStatePort();
    const application = createFixtureApplication({
      discoveryPort:
        stage === 'discovery'
          ? rejectingDiscovery('private provider text')
          : discoveryFixture(),
      statePort: state.port,
      catalogRevision: {
        async read() {
          if (stage === 'catalogRevision') {
            throw new Error('private revision text');
          }
          return 'catalog-r1';
        },
      },
    });

    if (stage === 'create') state.failOn = 'create';
    const discovered = await application.execute({
      key: 'catalog.intake.discover',
      input: { query: '鮮 さいとう', requestToken: `request-${stage}` },
    });
    if (['discovery', 'catalogRevision', 'create'].includes(stage)) {
      assertClosedAddFailure(discovered, 'dependency_failure');
      assert.doesNotMatch(JSON.stringify(discovered), /private/u);
      assert.equal(state.sessions.size, 0);
      continue;
    }

    assert.equal(discovered.ok, true);
    state.failOn = stage;
    const selected = await application.execute({
      key: 'catalog.intake.select',
      input: {
        sessionId: 'session-1',
        expectedSessionVersion: 1,
        ordinal: 1,
        ownerFields: { title: '鮮 さいとう' },
        requestResearch: false,
      },
    });
    assertClosedAddFailure(selected, 'dependency_failure');
    assert.doesNotMatch(JSON.stringify(selected), /private/u);
    assert.equal(state.replaceCalls, 0);
  }
});

test('only durable identity enters state and transient Google presentation cannot affect the preview digest', async () => {
  const digests = [];
  for (const transientName of ['SENTINEL GOOGLE A', 'SENTINEL GOOGLE B']) {
    const state = recordingStatePort();
    const application = createFixtureApplication({
      discoveryPort: discoveryFixture({ transientName }),
      statePort: state.port,
    });
    await application.execute({
      key: 'catalog.intake.discover',
      input: { query: '鮮 さいとう', requestToken: 'request-1' },
    });
    assert.equal(state.created.length, 1);
    assert.doesNotMatch(JSON.stringify(state.created), /SENTINEL|Google Maps/u);
    assert.deepEqual(Object.keys(state.created[0].candidates[0]).sort(), [
      'createdAt',
      'ordinal',
      'placeId',
      'providerNamespace',
    ]);
    const selected = await application.execute({
      key: 'catalog.intake.select',
      input: {
        sessionId: 'session-1',
        expectedSessionVersion: 1,
        ordinal: 1,
        ownerFields: { title: '鮮 さいとう' },
        requestResearch: false,
      },
    });
    digests.push(selected.value.preview.evidenceDigest);
  }
  assert.equal(digests[0], digests[1]);
});

test('malformed or expanded provider candidates fail closed before state persistence', async () => {
  for (const candidate of [
    {
      ...discoveryCandidate(),
      rawHtml: '<private>',
    },
    {
      ...discoveryCandidate(),
      durableIdentity: {
        ...discoveryCandidate().durableIdentity,
        candidateHash: 'forbidden-hash',
      },
    },
    {
      ...discoveryCandidate(),
      transientPresentation: {
        ...discoveryCandidate().transientPresentation,
        coordinates: { latitude: 35, longitude: 139 },
      },
    },
  ]) {
    const state = recordingStatePort();
    const application = createFixtureApplication({
      discoveryPort: {
        async discover() {
          return {
            ok: true,
            value: { candidates: [candidate], hasMore: false },
          };
        },
      },
      statePort: state.port,
    });
    const result = await application.execute({
      key: 'catalog.intake.discover',
      input: { query: '鮮', requestToken: 'request-1' },
    });
    assertClosedAddFailure(result, 'dependency_failure');
    assert.equal(state.sessions.size, 0);
  }
});

test('closed input validation accepts two-decimal Tabelog values and rejects foreign URLs, provenance fields, and Unicode controls', async () => {
  for (const score of [0.29, 2.03]) {
    const application = createFixtureApplication(discoveryFixture());
    await application.execute({
      key: 'catalog.intake.discover',
      input: { query: '鮮', requestToken: `request-${score}` },
    });
    const result = await application.execute({
      key: 'catalog.intake.select',
      input: {
        sessionId: 'session-1',
        expectedSessionVersion: 1,
        ordinal: 1,
        ownerFields: { title: '鮮' },
        tabelog: {
          score,
          url:
            score === 0.29
              ? 'https://tabelog.com/tokyo/A1307/A130701/13000001/'
              : 'https://www.tabelog.com/osaka/A2701/A270101/27000001/',
        },
        requestResearch: false,
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.value.preview.tabelog.score, score);
  }

  for (const input of [
    { query: `鮮\u0085私密`, requestToken: 'request-control' },
    { query: '鮮', requestToken: 'request-control\u0085' },
  ]) {
    const result = await createFixtureApplication(discoveryFixture()).execute({
      key: 'catalog.intake.discover',
      input,
    });
    assertClosedAddFailure(result, 'invalid_input');
  }

  const application = createFixtureApplication(discoveryFixture());
  await application.execute({
    key: 'catalog.intake.discover',
    input: { query: '鮮', requestToken: 'request-1' },
  });
  for (const forbidden of [
    { tabelog: { score: 4.2, url: 'https://example.com/not-tabelog' } },
    { tabelog: { score: 4.2, url: 'https://tabelog.com/help/rules/' } },
    { tabelog: { score: 4.2, url: 'https://tabelog.com/tokyo/rstLst/' } },
    { tabelog: { score: 4.2, url: 'https://tabelog.com/user/example/' } },
    { tabelog: { score: 4.2, url: 'https://tabelog.com/search/' } },
    {
      tabelog: {
        score: 4.2,
        url: 'https://tabelog.com/tokyo/A1307/A130701/',
      },
    },
    {
      tabelog: {
        score: 4.2,
        url: 'https://tabelog.com/tokyo/A1307/A130701/13000001/dtlmenu/',
      },
    },
    {
      tabelog: {
        score: 4.2,
        url: 'https://tabelog.com/tokyo/A1307/A130701/13000001/?sort=new',
      },
    },
    {
      ownerFields: {
        title: '鮮',
        provenance: 'agent_observed',
      },
    },
  ]) {
    const result = await application.execute({
      key: 'catalog.intake.select',
      input: {
        sessionId: 'session-1',
        expectedSessionVersion: 1,
        ordinal: 1,
        ownerFields: { title: '鮮' },
        requestResearch: false,
        ...forbidden,
      },
    });
    assertClosedAddFailure(result, 'invalid_input');
  }
});

async function discoverAndSelect(application, ownerFields = {}) {
  await application.execute({
    key: 'catalog.intake.discover',
    input: { query: '鮨 さいとう', requestToken: 'request-1' },
  });
  await application.execute({
    key: 'catalog.intake.select',
    input: {
      sessionId: 'session-1',
      expectedSessionVersion: 1,
      ordinal: 1,
      ownerFields: {
        title: '鮨 さいとう',
        address: '東京都港区六本木1-4-5',
        ...ownerFields,
      },
      requestResearch: false,
    },
  });
}

function createFixtureApplication(options) {
  const normalized = options.discoveryPort
    ? options
    : { discoveryPort: options };
  const intakeModule = createCatalogIntakeModule({
    discoveryPort: normalized.discoveryPort,
    statePort: normalized.statePort ?? createInMemoryCatalogIntakeStatePort(),
    clock: normalized.clock ?? {
      now: () => new Date('2026-09-22T10:00:00.000Z'),
    },
    idSource: { nextId: () => 'session-1' },
    ...(normalized.idSource ? { idSource: normalized.idSource } : {}),
    catalogRevision: normalized.catalogRevision ?? {
      read: async () => 'catalog-r1',
    },
    ...(normalized.durableGeocoderPort
      ? { durableGeocoderPort: normalized.durableGeocoderPort }
      : {}),
    ...(normalized.atlasCatalogIntakePort
      ? { atlasCatalogIntakePort: normalized.atlasCatalogIntakePort }
      : {}),
    ...(normalized.webResearchPort
      ? { webResearchPort: normalized.webResearchPort }
      : {}),
  });
  const application = createAtlasApplication(
    createCatalogIntakeOperationGroup(intakeModule),
  );
  return {
    ...application,
    execute(operation, context = ownerConversation) {
      return application.execute(operation, context);
    },
  };
}

function discoveryFixture(options = {}) {
  const candidate = discoveryCandidate(options);
  return {
    async discover() {
      return {
        ok: true,
        value: {
          candidates: [candidate],
          hasMore: false,
        },
      };
    },
    async refetch({ providerNamespace, placeId }) {
      assert.equal(
        providerNamespace,
        candidate.durableIdentity.providerNamespace,
      );
      assert.equal(placeId, candidate.durableIdentity.placeId);
      return { ok: true, value: candidate };
    },
  };
}

function discoveryCandidate(options = {}) {
  return {
    durableIdentity: {
      providerNamespace: 'google-places',
      placeId: 'place-1',
      ordinal: 1,
    },
    transientPresentation: {
      name: options.transientName ?? 'Transient Google name',
      address: 'Transient Google address',
      attribution: {
        label: 'Google Maps',
        url: 'https://maps.google.com/',
      },
    },
  };
}

function rejectingDiscovery(message) {
  return {
    async discover() {
      throw new Error(message);
    },
    async refetch() {
      throw new Error(message);
    },
  };
}

function expirationRacePort(base, race) {
  return {
    findByRequest: (...arguments_) => base.findByRequest(...arguments_),
    createReplacingActive: (...arguments_) =>
      base.createReplacingActive(...arguments_),
    get: (...arguments_) => base.get(...arguments_),
    cleanup: (...arguments_) => base.cleanup(...arguments_),
    async compareAndSwap(input) {
      if (input.next.state !== 'expired') return base.compareAndSwap(input);
      if (race === 'expired') {
        return { kind: 'conflict', current: input.next };
      }
      if (race === 'cancelled') {
        return {
          kind: 'conflict',
          current: {
            sessionId: input.sessionId,
            sessionVersion: input.expectedVersion + 1,
            state: 'cancelled',
            ...input.scope,
            cancelledFromVersion: input.expectedVersion,
            requestToken: input.next.requestToken,
            normalizedOwnerQuery: input.next.normalizedOwnerQuery,
            terminalAt: '2026-09-22T10:30:00.000Z',
            retainUntil: '2027-03-21T10:30:00.000Z',
          },
        };
      }
      const current = await base.get(input.scope, input.sessionId);
      return {
        kind: 'conflict',
        current: {
          ...current,
          sessionVersion: input.expectedVersion + 1,
          lastAcceptedActivityAt: '2026-09-22T10:29:59.000Z',
          expiresAt: '2026-09-22T10:59:59.000Z',
        },
      };
    },
  };
}

function recordingStatePort() {
  const state = {
    failOn: undefined,
    replaceCalls: 0,
    created: [],
    sessions: new Map(),
  };
  state.port = {
    async findByRequest(scope, requestToken) {
      const session = [...state.sessions.values()].find(
        (candidate) =>
          candidate.ownerId === scope.ownerId &&
          candidate.channel === scope.channel &&
          candidate.conversationId === scope.conversationId &&
          candidate.requestToken === requestToken,
      );
      return session ? structuredClone(session) : undefined;
    },
    async createReplacingActive(session) {
      if (state.failOn === 'create') throw new Error('private create text');
      const copy = structuredClone(session);
      state.created.push(copy);
      state.sessions.set(session.sessionId, copy);
      return { kind: 'created', session: copy };
    },
    async get(scope, sessionId) {
      if (state.failOn === 'get') throw new Error('private get text');
      const session = state.sessions.get(sessionId);
      return session &&
        session.ownerId === scope.ownerId &&
        session.channel === scope.channel &&
        session.conversationId === scope.conversationId
        ? structuredClone(session)
        : undefined;
    },
    async compareAndSwap({ scope, sessionId, expectedVersion, next }) {
      if (state.failOn === 'replace') throw new Error('private replace text');
      state.replaceCalls += 1;
      const current = state.sessions.get(sessionId);
      if (
        !current ||
        current.ownerId !== scope.ownerId ||
        current.channel !== scope.channel ||
        current.conversationId !== scope.conversationId ||
        current.sessionVersion !== expectedVersion
      ) {
        return {
          kind: 'conflict',
          ...(current ? { current: structuredClone(current) } : {}),
        };
      }
      const copy = structuredClone(next);
      state.sessions.set(sessionId, copy);
      return { kind: 'applied', session: copy };
    },
    async cleanup() {
      return { expired: 0, removed: 0 };
    },
  };
  return state;
}

function assertClosedAddFailure(result, code) {
  assert.equal(result.ok, false);
  assert.deepEqual(Object.keys(result.error).sort(), [
    'code',
    'message',
    'retryable',
  ]);
  assert.equal(result.error.kind, code === 'expired' ? 'conflict' : code);
  assert.equal(result.error.code, code);
  assert.equal(typeof result.error.retryable, 'boolean');
}
