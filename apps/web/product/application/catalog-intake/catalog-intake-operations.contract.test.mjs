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
    const result = await application.execute(operation);
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

async function discoverAndSelect(application) {
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
    clock: { now: () => new Date('2026-09-22T10:00:00.000Z') },
    idSource: { nextId: () => 'session-1' },
    catalogRevision: normalized.catalogRevision ?? {
      read: async () => 'catalog-r1',
    },
  });
  return createAtlasApplication(
    createCatalogIntakeOperationGroup(intakeModule),
  );
}

function discoveryFixture(options = {}) {
  return {
    async discover() {
      return {
        ok: true,
        value: {
          candidates: [discoveryCandidate(options)],
          hasMore: false,
        },
      };
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
    async create(session) {
      if (state.failOn === 'create') throw new Error('private create text');
      const copy = structuredClone(session);
      state.created.push(copy);
      state.sessions.set(session.sessionId, copy);
    },
    async get(sessionId) {
      if (state.failOn === 'get') throw new Error('private get text');
      const session = state.sessions.get(sessionId);
      return session ? structuredClone(session) : undefined;
    },
    async replace(session) {
      if (state.failOn === 'replace') throw new Error('private replace text');
      state.replaceCalls += 1;
      state.sessions.set(session.sessionId, structuredClone(session));
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
  assert.equal(result.error.kind, code);
  assert.equal(result.error.code, code);
  assert.equal(typeof result.error.retryable, 'boolean');
}
