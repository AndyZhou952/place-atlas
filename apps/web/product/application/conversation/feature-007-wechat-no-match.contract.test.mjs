import assert from 'node:assert/strict';
import test from 'node:test';

import { catalogIntakeResponse } from '../../../app/api/catalog-intake/catalog-intake-response.ts';
import { createAgentHttpHandler } from '../../../adapters/agent/agent-http-mapping.ts';
import {
  CatalogIntakeRequestError,
  createBrowserAtlasApplication,
} from '../../../features/atlas/atlas-api-client.ts';
import { createAtlasApplication } from '../atlas-application.ts';
import {
  createCatalogIntakeModule,
  createCatalogIntakeOperationGroup,
  createInMemoryCatalogIntakeStatePort,
} from '../catalog-intake/catalog-intake-coordinator.ts';
import {
  createAgentServiceGateway,
  InMemoryAgentGatewayState,
} from './agent-service-gateway.ts';
import { signAgentHttpRequest } from './agent-request-signing.ts';
import {
  createAgentToolCatalog,
  createProjectCommandRouter,
} from './project-command-router.ts';

const now = Date.parse('2026-09-24T10:00:00.000Z');
const serverConversationId = '000102030405060708090a0b0c0d0e0f';
const secret = 'feature-007-fixture-secret';
const actor = {
  actorId: 'wechat-owner',
  channel: 'wechat',
  conversationId: 'owner-dm',
  conversationType: 'direct',
};
const browserScope = {
  ownerId: 'owner',
  channel: 'web',
  conversationId: serverConversationId,
};
const agentScope = {
  ownerId: actor.actorId,
  channel: actor.channel,
  conversationId: actor.conversationId,
};

test('Browser and signed Agent produce the same no-match preview and one-confirm needs-review outcome', async () => {
  const browser = createBrowserHarness();
  const agent = createSignedAgentHarness();

  await browser.application.execute({
    key: 'catalog.intake.discover',
    input: {
      query: '讃岐うどん大使 東京麺通団',
      requestToken: 'browser-discover-1',
    },
  });
  const browserPreview = await browser.application.execute({
    key: 'catalog.intake.select',
    input: {
      sessionId: 'session-1',
      expectedSessionVersion: 1,
      ordinal: 1,
      requestResearch: false,
    },
  });
  const browserCommitted = await browser.application.execute({
    key: 'catalog.intake.confirm',
    input: {
      sessionId: 'session-1',
      expectedPreviewVersion: browserPreview.preview.previewVersion,
    },
  });

  await agent.invoke(
    'jpmap_add_discover',
    { query: '讃岐うどん大使 東京麺通団' },
    'agent-discover-1',
  );
  const agentPreviewReceipt = await agent.invoke(
    'jpmap_add_select',
    { ordinal: 1 },
    'agent-select-1',
  );
  const agentPreview = agentPreviewReceipt.result.intake;
  const agentCommittedReceipt = await agent.invoke(
    'jpmap_add_confirm',
    {},
    'agent-confirm-1',
  );
  const agentCommitted = agentCommittedReceipt.result.intake;

  assert.deepEqual(agentPreview, browserPreview);
  assert.deepEqual(agentCommitted, browserCommitted);
  assert.equal(agentPreviewReceipt.result.step, 'preview');
  assert.match(agentPreviewReceipt.result.replyText, /Owner 审核/u);
  assert.doesNotMatch(
    agentPreviewReceipt.result.replyText,
    /Add a restaurant name, area, or address/u,
  );
  assert.equal(agentCommittedReceipt.result.step, 'committed');
  assert.match(agentCommittedReceipt.result.replyText, /Owner 待审核/u);
  assert.equal(browser.publishCalls.length, 1);
  assert.equal(agent.publishCalls.length, 1);
  assert.equal(
    browser.publishCalls[0].preview.evidenceDigest,
    browserPreview.preview.evidenceDigest,
  );
  assert.equal(
    agent.publishCalls[0].preview.evidenceDigest,
    agentPreview.preview.evidenceDigest,
  );
});

test('Browser and signed Agent replay the exact ambiguous-location clarification after response loss', async () => {
  const ambiguousGeocoder = {
    async propose() {
      return {
        ok: true,
        value: { status: 'ambiguous' },
      };
    },
  };
  const browser = createBrowserHarness({
    durableGeocoderPort: ambiguousGeocoder,
  });
  const agent = createSignedAgentHarness({
    durableGeocoderPort: ambiguousGeocoder,
  });

  await browser.application.execute({
    key: 'catalog.intake.discover',
    input: {
      query: '讃岐うどん大使 東京麺通団',
      requestToken: 'browser-ambiguous-discover',
    },
  });
  const browserFirst = await browser.application.execute({
    key: 'catalog.intake.select',
    input: {
      sessionId: 'session-1',
      expectedSessionVersion: 1,
      ordinal: 1,
      requestResearch: false,
    },
  });
  const browserReplay = await browser.application.execute({
    key: 'catalog.intake.select',
    input: {
      sessionId: 'session-1',
      expectedSessionVersion: 1,
      ordinal: 1,
      requestResearch: false,
    },
  });

  await agent.invoke(
    'jpmap_add_discover',
    { query: '讃岐うどん大使 東京麺通団' },
    'agent-ambiguous-discover',
  );
  const agentFirstReceipt = await agent.invoke(
    'jpmap_add_select',
    { ordinal: 1 },
    'agent-ambiguous-select-1',
  );
  const agentReplayReceipt = await agent.invoke(
    'jpmap_add_select',
    { ordinal: 1 },
    'agent-ambiguous-select-1',
  );

  assert.deepEqual(browserFirst, browserReplay);
  assert.deepEqual(
    agentFirstReceipt.result.intake,
    agentReplayReceipt.result.intake,
  );
  assert.deepEqual(agentFirstReceipt.result.intake, browserFirst);
  assert.deepEqual(browserFirst.clarification, {
    code: 'ambiguous_location',
    prompt: 'Add an area or address to identify the right place.',
    fields: ['area', 'address'],
  });
  for (const value of [
    browserFirst,
    browserReplay,
    agentFirstReceipt.result,
    agentReplayReceipt.result,
  ]) {
    assert.doesNotMatch(
      JSON.stringify(value),
      /Add a restaurant name, area, or address to continue/u,
    );
    assert.doesNotMatch(JSON.stringify(value), /missing_area_or_address/u);
  }
});

test('Browser and signed Agent preserve retryability for provider failures', async () => {
  const cases = [
    {
      name: 'unavailable',
      discoveryPort: {
        async discover() {
          return {
            ok: false,
            error: { kind: 'dependency_failure', message: 'private outage' },
          };
        },
        async refetch() {
          throw new Error('not reached');
        },
      },
      retryable: true,
    },
    {
      name: 'malformed',
      discoveryPort: {
        async discover() {
          return {
            ok: true,
            value: { candidates: 'not-an-array', hasMore: false },
          };
        },
        async refetch() {
          throw new Error('not reached');
        },
      },
      retryable: false,
    },
  ];

  for (const scenario of cases) {
    const browser = createBrowserHarness({
      discoveryPort: scenario.discoveryPort,
    });
    const agent = createSignedAgentHarness({
      discoveryPort: scenario.discoveryPort,
    });
    let browserError;
    try {
      await browser.application.execute({
        key: 'catalog.intake.discover',
        input: {
          query: 'provider outcome fixture',
          requestToken: `browser-${scenario.name}`,
        },
      });
    } catch (error) {
      browserError = error;
    }
    assert.equal(browserError instanceof CatalogIntakeRequestError, true);
    assert.deepEqual(
      { code: browserError.code, retryable: browserError.retryable },
      { code: 'dependency_failure', retryable: scenario.retryable },
    );

    const agentResponse = await agent.invokeRaw(
      'jpmap_add_discover',
      { query: 'provider outcome fixture' },
      `agent-${scenario.name}`,
    );
    assert.equal(agentResponse.status, 503);
    assert.deepEqual(agentResponse.payload, {
      ok: false,
      error: {
        kind: 'dependency_failure',
        message: 'Japan Atlas is temporarily unavailable.',
        retryable: scenario.retryable,
      },
    });
    assert.equal(browser.publishCalls.length, 0);
    assert.equal(agent.publishCalls.length, 0);
  }
});

test('provider outcome matrix is equivalent through Browser and signed Agent discover/select seams', async () => {
  const discoverCases = [
    {
      name: 'discover empty',
      makeOptions: () => ({
        discoveryPort: {
          async discover() {
            return { ok: true, value: { candidates: [], hasMore: false } };
          },
          async refetch() {
            throw new Error('not reached');
          },
        },
      }),
      expected: { kind: 'success', status: 'clarification_required' },
    },
    {
      name: 'discover unavailable or rate limited',
      makeOptions: () => ({
        discoveryPort: {
          async discover() {
            return {
              ok: false,
              error: { kind: 'rate_limited', message: 'private detail' },
            };
          },
          async refetch() {
            throw new Error('not reached');
          },
        },
      }),
      expected: {
        kind: 'error',
        code: 'dependency_failure',
        retryable: true,
      },
    },
    {
      name: 'discover malformed',
      makeOptions: () => ({
        discoveryPort: {
          async discover() {
            return { ok: true, value: { candidates: [], hasMore: 'no' } };
          },
          async refetch() {
            throw new Error('not reached');
          },
        },
      }),
      expected: {
        kind: 'error',
        code: 'dependency_failure',
        retryable: false,
      },
    },
  ];

  for (const scenario of discoverCases) {
    const outcomes = await runDualDiscover(scenario.makeOptions);
    assert.deepEqual(outcomes.browser, scenario.expected, scenario.name);
    assert.deepEqual(outcomes.agent, scenario.expected, scenario.name);
    assert.equal(outcomes.browserHarness.publishCalls.length, 0, scenario.name);
    assert.equal(outcomes.agentHarness.publishCalls.length, 0, scenario.name);
    if (scenario.expected.kind === 'error') {
      assert.equal(
        await outcomes.browserHarness.state.findByRequest(
          browserScope,
          'matrix-browser',
        ),
        undefined,
        scenario.name,
      );
      assert.equal(
        await outcomes.agentHarness.state.findByRequest(
          agentScope,
          'matrix-agent',
        ),
        undefined,
        scenario.name,
      );
    }
  }

  const selectCases = [
    {
      name: 'select refetch unavailable',
      makeOptions: () => ({
        discoveryPort: stagedDiscovery({
          selectRefetch: {
            ok: false,
            error: { kind: 'dependency_failure', message: 'private detail' },
          },
        }),
      }),
      expected: {
        kind: 'error',
        code: 'dependency_failure',
        retryable: true,
      },
    },
    {
      name: 'select refetch malformed',
      makeOptions: () => ({
        discoveryPort: stagedDiscovery({
          selectRefetch: { ok: true, value: { malformed: true } },
        }),
      }),
      expected: {
        kind: 'error',
        code: 'dependency_failure',
        retryable: false,
      },
    },
    {
      name: 'select refetch obsolete or not found',
      makeOptions: () => ({
        discoveryPort: stagedDiscovery({
          selectRefetch: {
            ok: false,
            error: { kind: 'not_found', message: 'private detail' },
          },
        }),
      }),
      expected: {
        kind: 'error',
        code: 'dependency_failure',
        retryable: false,
      },
    },
    {
      name: 'select identity mismatch',
      makeOptions: () => ({
        discoveryPort: stagedDiscovery({
          selectRefetch: {
            ok: true,
            value: placeCandidate({ placeId: 'different-place-id' }),
          },
        }),
      }),
      expected: {
        kind: 'error',
        code: 'dependency_failure',
        retryable: false,
      },
    },
    {
      name: 'geocoder resolved',
      makeOptions: () => ({
        discoveryPort: stagedDiscovery(),
        durableGeocoderPort: geocoderWith({
          ok: true,
          value: resolvedLocation(),
        }),
      }),
      expected: {
        kind: 'success',
        status: 'preview_ready',
        location: 'known',
        warnings: ['needs_review'],
      },
    },
    {
      name: 'geocoder ambiguous',
      makeOptions: () => ({
        discoveryPort: stagedDiscovery(),
        durableGeocoderPort: geocoderWith({
          ok: true,
          value: { status: 'ambiguous' },
        }),
      }),
      expected: {
        kind: 'success',
        status: 'clarification_required',
        clarification: 'ambiguous_location',
      },
    },
    {
      name: 'geocoder no match',
      makeOptions: () => ({
        discoveryPort: stagedDiscovery(),
        durableGeocoderPort: geocoderWith({
          ok: true,
          value: { status: 'no_match' },
        }),
      }),
      expected: {
        kind: 'success',
        status: 'preview_ready',
        location: 'unknown',
        warnings: ['needs_review'],
      },
    },
    {
      name: 'geocoder unavailable or rate limited',
      makeOptions: () => ({
        discoveryPort: stagedDiscovery(),
        durableGeocoderPort: geocoderWith({
          ok: false,
          error: { kind: 'rate_limited', message: 'private detail' },
        }),
      }),
      expected: {
        kind: 'success',
        status: 'preview_ready',
        location: 'unknown',
        warnings: ['needs_review', 'provider_unavailable'],
      },
    },
    {
      name: 'research disabled',
      makeOptions: () => ({
        discoveryPort: stagedDiscovery(),
        durableGeocoderPort: geocoderWith({
          ok: true,
          value: { status: 'no_match' },
        }),
      }),
      expected: {
        kind: 'success',
        status: 'preview_ready',
        location: 'unknown',
        warnings: ['needs_review'],
      },
    },
    {
      name: 'research enabled failure',
      makeOptions: () => ({
        discoveryPort: stagedDiscovery(),
        durableGeocoderPort: geocoderWith({
          ok: true,
          value: { status: 'no_match' },
        }),
        webResearchPort: {
          async research() {
            return { kind: 'unavailable' };
          },
        },
      }),
      expected: {
        kind: 'success',
        status: 'preview_ready',
        location: 'unknown',
        warnings: ['needs_review', 'provider_unavailable'],
      },
    },
  ];

  for (const scenario of selectCases) {
    const outcomes = await runDualSelect(scenario.makeOptions);
    assert.deepEqual(outcomes.browser, scenario.expected, scenario.name);
    assert.deepEqual(outcomes.agent, scenario.expected, scenario.name);
    assert.equal(outcomes.browserHarness.publishCalls.length, 0, scenario.name);
    assert.equal(outcomes.agentHarness.publishCalls.length, 0, scenario.name);
    if (scenario.expected.kind === 'error') {
      assert.equal(
        (await outcomes.browserHarness.state.get(browserScope, 'session-1'))
          .sessionVersion,
        1,
        scenario.name,
      );
      assert.equal(
        (await outcomes.agentHarness.state.get(agentScope, 'session-1'))
          .sessionVersion,
        1,
        scenario.name,
      );
    }
  }
});

test('provider outcome matrix is equivalent through Browser and signed Agent confirm seam', async () => {
  const confirmCases = [
    {
      name: 'confirm durable evidence change',
      makeOptions: () => ({
        discoveryPort: stagedDiscovery(),
        durableGeocoderPort: sequencedGeocoder([
          { ok: true, value: { status: 'no_match' } },
          { ok: true, value: resolvedLocation() },
        ]),
      }),
      expected: { kind: 'success', status: 'conflict' },
      publishCalls: 0,
    },
    {
      name: 'confirm durable identity change',
      makeOptions: () => ({
        discoveryPort: stagedDiscovery({
          confirmRefetch: {
            ok: true,
            value: placeCandidate({ placeId: 'replacement-place-id' }),
          },
        }),
        durableGeocoderPort: geocoderWith({
          ok: true,
          value: { status: 'no_match' },
        }),
      }),
      expected: { kind: 'success', status: 'conflict' },
      publishCalls: 0,
    },
    ...[
      {
        name: 'confirm identity unavailable',
        refresh: {
          ok: false,
          error: {
            kind: 'dependency_failure',
            message: 'private unavailable detail',
          },
        },
        privateMarker: 'private unavailable detail',
      },
      {
        name: 'confirm identity rate limited',
        refresh: {
          ok: false,
          error: {
            kind: 'rate_limited',
            message: 'private rate-limit detail',
          },
        },
        privateMarker: 'private rate-limit detail',
      },
      {
        name: 'confirm identity malformed response',
        refresh: {
          ok: true,
          value: {
            malformed: true,
            privateProviderBody: 'private malformed detail',
          },
        },
        privateMarker: 'private malformed detail',
      },
      {
        name: 'confirm identity obsolete or not found',
        refresh: {
          ok: false,
          error: {
            kind: 'not_found',
            message: 'private obsolete detail',
          },
        },
        privateMarker: 'private obsolete detail',
      },
    ].map(({ name, refresh, privateMarker }) => ({
      name,
      makeOptions: () => ({
        discoveryPort: stagedDiscovery({ confirmRefetch: refresh }),
        durableGeocoderPort: geocoderWith({
          ok: true,
          value: { status: 'no_match' },
        }),
      }),
      expected: {
        kind: 'success',
        status: 'failed_no_write',
        reason: 'dependency',
      },
      expectedHttpStatus: 200,
      expectedRetryable: false,
      expectSessionUnchanged: true,
      privateMarker,
      publishCalls: 0,
    })),
    {
      name: 'publisher closed no-write',
      makeOptions: () => ({
        discoveryPort: stagedDiscovery(),
        durableGeocoderPort: geocoderWith({
          ok: true,
          value: { status: 'no_match' },
        }),
        atlasCatalogIntakePort: {
          async publish() {
            return { status: 'failed_no_write', reason: 'transaction' };
          },
        },
      }),
      expected: {
        kind: 'success',
        status: 'failed_no_write',
        reason: 'transaction',
      },
      publishCalls: 1,
    },
    {
      name: 'publisher exception',
      makeOptions: () => ({
        discoveryPort: stagedDiscovery(),
        durableGeocoderPort: geocoderWith({
          ok: true,
          value: { status: 'no_match' },
        }),
        atlasCatalogIntakePort: {
          async publish() {
            throw new Error('private publisher detail');
          },
        },
      }),
      expected: {
        kind: 'error',
        code: 'dependency_failure',
        retryable: true,
      },
      publishCalls: 1,
    },
  ];

  for (const scenario of confirmCases) {
    const outcomes = await runDualConfirm(scenario.makeOptions);
    assert.deepEqual(outcomes.browser, scenario.expected, scenario.name);
    assert.deepEqual(outcomes.agent, scenario.expected, scenario.name);
    assert.equal(
      outcomes.browserHarness.publishCalls.length,
      scenario.publishCalls,
      scenario.name,
    );
    assert.equal(
      outcomes.agentHarness.publishCalls.length,
      scenario.publishCalls,
      scenario.name,
    );
    if (scenario.expectedHttpStatus !== undefined) {
      assert.equal(
        outcomes.browserExchange.status,
        scenario.expectedHttpStatus,
        `${scenario.name}: Browser HTTP status`,
      );
      assert.equal(
        outcomes.agentExchange.status,
        scenario.expectedHttpStatus,
        `${scenario.name}: Agent HTTP status`,
      );
      assert.equal(
        externalRetryable(outcomes.browserExchange),
        scenario.expectedRetryable,
        `${scenario.name}: Browser retryability`,
      );
      assert.equal(
        externalRetryable(outcomes.agentExchange),
        scenario.expectedRetryable,
        `${scenario.name}: Agent retryability`,
      );
    }
    if (scenario.expectSessionUnchanged) {
      assert.deepEqual(
        outcomes.browserSessionAfter,
        outcomes.browserSessionBefore,
        `${scenario.name}: Browser session`,
      );
      assert.deepEqual(
        outcomes.agentSessionAfter,
        outcomes.agentSessionBefore,
        `${scenario.name}: Agent session`,
      );
    }
    if (scenario.privateMarker) {
      assert.doesNotMatch(
        JSON.stringify(outcomes.browserExchange),
        new RegExp(scenario.privateMarker, 'u'),
        `${scenario.name}: Browser private provider detail`,
      );
      assert.doesNotMatch(
        JSON.stringify(outcomes.agentExchange),
        new RegExp(scenario.privateMarker, 'u'),
        `${scenario.name}: Agent private provider detail`,
      );
    }
    assert.doesNotMatch(
      JSON.stringify(outcomes),
      /private detail/u,
      scenario.name,
    );
  }
});

test('Browser and signed Agent close expiry and CAS races without catalog writes', async () => {
  for (const channel of ['browser', 'agent']) {
    let currentTime = now;
    const options = {
      discoveryPort: stagedDiscovery(),
      durableGeocoderPort: geocoderWith({
        ok: true,
        value: { status: 'no_match' },
      }),
      clock: { now: () => new Date(currentTime) },
    };
    const harness =
      channel === 'browser'
        ? createBrowserHarness(options)
        : createSignedAgentHarness(options);
    if (channel === 'browser') {
      await harness.application.execute({
        key: 'catalog.intake.discover',
        input: { query: 'expiry fixture', requestToken: 'expiry-browser' },
      });
    } else {
      await harness.invoke(
        'jpmap_add_discover',
        { query: 'expiry fixture' },
        'expiry-agent',
      );
    }
    currentTime += 31 * 60 * 1_000;
    let outcome;
    if (channel === 'browser') {
      outcome = await executeBrowserRaw(harness.application, {
        key: 'catalog.intake.select',
        input: {
          sessionId: 'session-1',
          expectedSessionVersion: 1,
          ordinal: 1,
          requestResearch: true,
        },
      });
    } else {
      const raw = await harness.invokeRaw(
        'jpmap_add_select',
        { ordinal: 1 },
        'expiry-agent-select',
      );
      assert.equal(raw.status, 410);
      assert.equal(
        raw.payload.error.message,
        'Japan Atlas｜本次 Add 已过期，请重新发送 /jpmap add <餐厅名>。',
      );
      outcome = normalizeAgentResponse(raw);
    }
    assert.deepEqual(outcome, {
      kind: 'error',
      code: 'expired',
      retryable: false,
    });
    assert.equal(harness.publishCalls.length, 0);
  }

  for (const channel of ['browser', 'agent']) {
    const clock = { now: () => new Date(now) };
    const baseState = createInMemoryCatalogIntakeStatePort(clock);
    let injected = false;
    const racingState = {
      ...baseState,
      async compareAndSwap(input) {
        if (!injected && input.next.state === 'preview_ready') {
          injected = true;
          const applied = await baseState.compareAndSwap(input);
          assert.equal(applied.kind, 'applied');
          return { kind: 'conflict', current: applied.session };
        }
        return baseState.compareAndSwap(input);
      },
    };
    const options = {
      discoveryPort: stagedDiscovery(),
      durableGeocoderPort: geocoderWith({
        ok: true,
        value: { status: 'no_match' },
      }),
      clock,
      statePort: racingState,
    };
    const harness =
      channel === 'browser'
        ? createBrowserHarness(options)
        : createSignedAgentHarness(options);
    if (channel === 'browser') {
      await harness.application.execute({
        key: 'catalog.intake.discover',
        input: { query: 'CAS fixture', requestToken: 'cas-browser' },
      });
      const selected = await harness.application.execute({
        key: 'catalog.intake.select',
        input: {
          sessionId: 'session-1',
          expectedSessionVersion: 1,
          ordinal: 1,
          requestResearch: true,
        },
      });
      assert.equal(selected.status, 'preview_ready');
    } else {
      await harness.invoke(
        'jpmap_add_discover',
        { query: 'CAS fixture' },
        'cas-agent',
      );
      const selected = await harness.invoke(
        'jpmap_add_select',
        { ordinal: 1 },
        'cas-agent-select',
      );
      assert.equal(selected.result.intake.status, 'preview_ready');
    }
    assert.equal(injected, true);
    assert.equal(harness.publishCalls.length, 0);
  }
});

async function runDualDiscover(makeOptions) {
  const browserHarness = createBrowserHarness(makeOptions());
  const agentHarness = createSignedAgentHarness(makeOptions());
  const browser = await executeBrowserRaw(browserHarness.application, {
    key: 'catalog.intake.discover',
    input: { query: 'matrix fixture', requestToken: 'matrix-browser' },
  });
  const agent = normalizeAgentResponse(
    await agentHarness.invokeRaw(
      'jpmap_add_discover',
      { query: 'matrix fixture' },
      'matrix-agent',
    ),
  );
  return { browser, agent, browserHarness, agentHarness };
}

async function runDualSelect(makeOptions) {
  const browserHarness = createBrowserHarness(makeOptions());
  const agentHarness = createSignedAgentHarness(makeOptions());
  await browserHarness.application.execute({
    key: 'catalog.intake.discover',
    input: { query: 'matrix fixture', requestToken: 'matrix-browser' },
  });
  await agentHarness.invoke(
    'jpmap_add_discover',
    { query: 'matrix fixture' },
    'matrix-agent',
  );
  const browser = await executeBrowserRaw(browserHarness.application, {
    key: 'catalog.intake.select',
    input: {
      sessionId: 'session-1',
      expectedSessionVersion: 1,
      ordinal: 1,
      requestResearch: true,
    },
  });
  const agent = normalizeAgentResponse(
    await agentHarness.invokeRaw(
      'jpmap_add_select',
      { ordinal: 1 },
      'matrix-agent-select',
    ),
  );
  return { browser, agent, browserHarness, agentHarness };
}

async function runDualConfirm(makeOptions) {
  const browserHarness = createBrowserHarness(makeOptions());
  const agentHarness = createSignedAgentHarness(makeOptions());
  await browserHarness.application.execute({
    key: 'catalog.intake.discover',
    input: { query: 'matrix fixture', requestToken: 'matrix-browser' },
  });
  const browserPreview = await browserHarness.application.execute({
    key: 'catalog.intake.select',
    input: {
      sessionId: 'session-1',
      expectedSessionVersion: 1,
      ordinal: 1,
      requestResearch: true,
    },
  });
  await agentHarness.invoke(
    'jpmap_add_discover',
    { query: 'matrix fixture' },
    'matrix-agent',
  );
  await agentHarness.invoke(
    'jpmap_add_select',
    { ordinal: 1 },
    'matrix-agent-select',
  );
  const browserSessionBefore = structuredClone(
    await browserHarness.state.get(browserScope, 'session-1'),
  );
  const agentSessionBefore = structuredClone(
    await agentHarness.state.get(agentScope, 'session-1'),
  );
  const browser = await executeBrowserRaw(browserHarness.application, {
    key: 'catalog.intake.confirm',
    input: {
      sessionId: 'session-1',
      expectedPreviewVersion: browserPreview.preview.previewVersion,
    },
  });
  const agentExchange = await agentHarness.invokeRaw(
    'jpmap_add_confirm',
    {},
    'matrix-agent-confirm',
  );
  const agent = normalizeAgentResponse(agentExchange);
  const browserExchange = browserHarness.httpExchanges.at(-1);
  assert.ok(browserExchange, 'Browser confirm HTTP exchange was captured');
  return {
    browser,
    agent,
    browserExchange,
    agentExchange,
    browserSessionBefore,
    browserSessionAfter: structuredClone(
      await browserHarness.state.get(browserScope, 'session-1'),
    ),
    agentSessionBefore,
    agentSessionAfter: structuredClone(
      await agentHarness.state.get(agentScope, 'session-1'),
    ),
    browserHarness,
    agentHarness,
  };
}

function externalRetryable(exchange) {
  return exchange.status >= 400
    ? exchange.payload.error?.retryable === true
    : false;
}

async function executeBrowserRaw(application, operation) {
  try {
    return normalizeIntakeOutcome(await application.execute(operation));
  } catch (error) {
    assert.equal(error instanceof CatalogIntakeRequestError, true);
    return {
      kind: 'error',
      code: error.code,
      retryable: error.retryable ?? false,
    };
  }
}

function normalizeAgentResponse({ status, payload }) {
  if (status === 200) {
    assert.equal(payload.ok, true);
    return normalizeIntakeOutcome(payload.receipt.result.intake);
  }
  assert.equal(payload.ok, false);
  return {
    kind: 'error',
    code: payload.error.kind,
    retryable: payload.error.retryable ?? false,
  };
}

function normalizeIntakeOutcome(value) {
  if (value.status === 'preview_ready') {
    return {
      kind: 'success',
      status: value.status,
      location: value.preview.locationEvidence.status,
      warnings: value.preview.warnings.map(({ code }) => code).sort(),
    };
  }
  if (value.status === 'clarification_required' && value.clarification) {
    return {
      kind: 'success',
      status: value.status,
      clarification: value.clarification.code,
    };
  }
  if (value.status === 'failed_no_write') {
    return {
      kind: 'success',
      status: value.status,
      reason: value.reason,
    };
  }
  return { kind: 'success', status: value.status };
}

function placeCandidate({ placeId = 'tokyo-mentsudan-place-id' } = {}) {
  return {
    durableIdentity: {
      providerNamespace: 'google-places',
      placeId,
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
}

function stagedDiscovery({
  selectRefetch = { ok: true, value: placeCandidate() },
  confirmRefetch = { ok: true, value: placeCandidate() },
} = {}) {
  let refetchCalls = 0;
  return {
    async discover() {
      return {
        ok: true,
        value: { candidates: [placeCandidate()], hasMore: false },
      };
    },
    async refetch() {
      refetchCalls += 1;
      return refetchCalls === 1 ? selectRefetch : confirmRefetch;
    },
  };
}

function geocoderWith(outcome) {
  return {
    async propose() {
      return outcome;
    },
  };
}

function sequencedGeocoder(outcomes) {
  let calls = 0;
  return {
    async propose() {
      const outcome = outcomes[Math.min(calls, outcomes.length - 1)];
      calls += 1;
      return outcome;
    },
  };
}

function resolvedLocation() {
  return {
    status: 'resolved',
    normalizedAddress: '東京都新宿区西新宿7丁目9-15',
    latitude: 35.6951,
    longitude: 139.6974,
    provider: 'fixture-osm-geocoder',
    sourceUrl: 'https://www.openstreetmap.org/node/123',
    license: 'ODbL-1.0',
    checkedAt: '2026-09-24T10:00:00.000Z',
  };
}

function createBrowserHarness(options = {}) {
  const fixture = createIntakeFixture(options);
  let conversation;
  const httpExchanges = [];
  const application = createBrowserAtlasApplication(
    {
      async request(path, init) {
        const operation = operationForPath(path);
        const response = await catalogIntakeResponse({
          application: fixture.application,
          request: new Request(`https://atlas.test${path}`, init),
          operation,
          serverConversationId,
        });
        httpExchanges.push({
          status: response.status,
          payload: await response.clone().json(),
        });
        return response;
      },
    },
    {
      read: () => conversation,
      write(value) {
        conversation = value;
      },
    },
  );
  return { ...fixture, application, httpExchanges };
}

function createSignedAgentHarness(options = {}) {
  const fixture = createIntakeFixture(options);
  const router = createProjectCommandRouter(createAtlasApplication({}), {
    catalogIntakeApplication: fixture.application,
    conversationResolver: {
      async resolve(invocation) {
        const session = await fixture.state.get(invocation, 'session-1');
        if (!session) return undefined;
        if (session.state === 'candidates_ready') {
          return {
            state: 'candidates_ready',
            sessionId: session.sessionId,
            sessionVersion: session.sessionVersion,
          };
        }
        if (session.state === 'preview_ready') {
          return {
            state: 'preview_ready',
            sessionId: session.sessionId,
            sessionVersion: session.sessionVersion,
            previewVersion: session.preview.previewVersion,
          };
        }
        if (session.state === 'committed') {
          return {
            state: 'committed',
            sessionId: session.sessionId,
            sessionVersion: session.sessionVersion,
            previewVersion: session.previewVersion,
          };
        }
        return undefined;
      },
    },
  });
  const gateway = createAgentServiceGateway({
    router,
    toolCatalog: createAgentToolCatalog(),
    manifestPhase: 'owner',
    keys: {
      async find(keyId) {
        return keyId === 'key-1'
          ? {
              keyId,
              projectId: 'jpmap',
              secret,
              active: true,
              owner: actor,
              scopes: ['atlas:intake:write'],
            }
          : undefined;
      },
    },
    state: new InMemoryAgentGatewayState(),
    audit: { async record() {} },
    clock: { nowMs: () => now },
  });
  const handle = createAgentHttpHandler(gateway);
  let nonce = 0;
  return {
    ...fixture,
    async invokeRaw(tool, input, mutationId) {
      nonce += 1;
      const request = await signAgentHttpRequest({
        url: 'https://atlas.test/api/agent/v1/tools',
        method: 'POST',
        body: {
          version: '1',
          projectId: 'jpmap',
          tool,
          mutationId,
          actor,
          input,
        },
        keyId: 'key-1',
        secret,
        timestamp: String(Math.floor(now / 1_000)),
        nonce: `feature-007-${nonce}`,
      });
      const response = await handle(request);
      return { status: response.status, payload: await response.json() };
    },
    async invoke(tool, input, mutationId) {
      const { status, payload } = await this.invokeRaw(tool, input, mutationId);
      assert.equal(status, 200, JSON.stringify(payload));
      assert.equal(payload.ok, true);
      return payload.receipt;
    },
  };
}

function createIntakeFixture(options = {}) {
  const clock = options.clock ?? { now: () => new Date(now) };
  const state =
    options.statePort ?? createInMemoryCatalogIntakeStatePort(clock);
  const publishCalls = [];
  const configuredCatalogIntakePort = options.atlasCatalogIntakePort;
  const atlasCatalogIntakePort = {
    async publish(
      preview,
      mutationKey,
      expectedSessionVersion,
      catalogRevision,
    ) {
      publishCalls.push({ preview, mutationKey, expectedSessionVersion });
      if (configuredCatalogIntakePort) {
        return configuredCatalogIntakePort.publish(
          preview,
          mutationKey,
          expectedSessionVersion,
          catalogRevision,
        );
      }
      return {
        status: 'committed_needs_review',
        itemId: 'candidate-1',
        receiptRef: 'receipt-1',
        replayed: false,
      };
    },
  };
  const application = createAtlasApplication(
    createCatalogIntakeOperationGroup(
      createCatalogIntakeModule({
        discoveryPort: options.discoveryPort ?? discoveryFixture(),
        durableGeocoderPort: options.durableGeocoderPort ?? {
          async propose() {
            return { ok: true, value: { status: 'no_match' } };
          },
        },
        webResearchPort: options.webResearchPort,
        atlasCatalogIntakePort,
        statePort: state,
        clock,
        idSource: { nextId: () => 'session-1' },
        catalogRevision: { read: async () => 'catalog-r1' },
      }),
    ),
  );
  return { application, state, publishCalls };
}

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

function operationForPath(path) {
  const operation = new URL(path, 'https://atlas.test').pathname
    .split('/')
    .at(-1);
  assert.ok(
    ['discover', 'select', 'confirm', 'cancel'].includes(operation),
    `Unexpected catalog intake path: ${path}`,
  );
  return `catalog.intake.${operation}`;
}
