import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveCatalogIntakeResearchInputDigest } from '../../product/application/catalog-intake/catalog-intake-coordinator.ts';
import {
  signResearchAllowance,
  verifyResearchResult,
} from './research-relay-envelope.ts';
import { createResearchRelayHandler } from './research-relay-handler.ts';

const key = { keyVersion: 'relay-k1', secret: 's'.repeat(32) };
const keys = { 'relay-k1': key.secret };
const initialNow = new Date('2026-09-23T10:00:00.000Z');
const confirmSubject = {
  ownerQuery: '鮨 さいとう',
  providerNamespace: 'google-places',
  placeId: 'confirm-branch',
  transientName: 'Sushi Saito',
  transientAddress: 'Roppongi, Tokyo',
};

test('Relay claims before exact OpenClaw search/fetch and response-loss retry cannot egress twice', async () => {
  const events = [];
  let claimed = false;
  const query = '鮨 さいとう';
  const allowance = await signedAllowance({
    phase: 'initial',
    requestId: 'initial-request',
    queryOrUrlsDigest: await deriveCatalogIntakeResearchInputDigest({
      phase: 'initial',
      normalizedOwnerQuery: query,
    }),
  });
  const handler = createResearchRelayHandler({
    allowanceKeys: keys,
    resultKey: key,
    now: () => initialNow,
    replayGuard: {
      async claim() {
        events.push('claim');
        if (claimed) return { kind: 'replay' };
        claimed = true;
        return { kind: 'claimed' };
      },
      async cleanup() {
        return 0;
      },
    },
    searchTool: {
      async invoke(input) {
        events.push('search');
        assert.equal(input.signal instanceof AbortSignal, true);
        assert.equal(
          input.deadlineAtMs,
          Date.parse(allowance.allowance.deadline),
        );
        const {
          signal: _signal,
          deadlineAtMs: _deadline,
          ...toolInput
        } = input;
        assert.deepEqual(toolInput, {
          toolId: 'openclaw.web_search',
          toolVersion: 'v1',
          arguments: {
            query,
            maxResults: 3,
            output: 'url_candidates_only',
          },
        });
        return {
          urls: [
            'https://tabelog.com/tokyo/A1307/A130701/13000001/',
            'https://restaurant.example/reservations',
          ],
        };
      },
    },
    transport: fixtureTransport(events),
    extractor: fixtureExtractor(events),
  });

  const first = await handler.handle(allowance, {
    phase: 'initial',
    query,
  });
  assert.equal(first.status, 'ok');
  const verified = await verifyResearchResult(first.result, {
    keys,
    now: initialNow,
    allowance: allowance.allowance,
    allowanceDigest: allowance.allowanceDigest,
  });
  assert.deepEqual(verified, {
    outcome: { kind: 'observed', proposal: expectedProposal },
    usage: {
      searchQueries: 1,
      pageRequests: 2,
      elapsedMs: 0,
      maximumRedirectsFollowed: 1,
    },
  });
  assert.doesNotMatch(
    JSON.stringify(first),
    /raw|html|review text|fixture body/iu,
  );
  assert.deepEqual(events, [
    'claim',
    'search',
    'fetch:tabelog.com',
    'extract:tabelog.com',
    'fetch:restaurant.example',
    'extract:restaurant.example',
  ]);

  assert.deepEqual(
    await handler.handle(allowance, { phase: 'initial', query }),
    { status: 'rejected', reason: 'replay' },
  );
  assert.deepEqual(events.slice(6), ['claim']);
});

test(
  'Relay cooperatively aborts never-resolving search and extractor at one shared deadline',
  { timeout: 1_000 },
  async () => {
    for (const blockedStage of ['search', 'extractor']) {
      const now = new Date();
      const query = '鮨 さいとう';
      const url = 'https://tabelog.com/tokyo/A1307/A130701/13000001/';
      const phase = blockedStage === 'search' ? 'initial' : 'confirm';
      const phaseInput =
        phase === 'initial' ? { phase, query } : confirmPhaseInput([url]);
      const queryOrUrlsDigest =
        phase === 'initial'
          ? await deriveCatalogIntakeResearchInputDigest({
              phase,
              normalizedOwnerQuery: query,
            })
          : await confirmInputDigest([url]);
      const allowance = await signResearchAllowance({
        allowance: {
          sessionId: 'deadline-session',
          phase,
          queryOrUrlsDigest,
          maxCounts: {
            searchQueries: phase === 'initial' ? 1 : 0,
            pageRequests: phase === 'initial' ? 3 : 2,
          },
          maxDurationMs: phase === 'initial' ? 35_000 : 25_000,
          requestTimeoutMs: 15_000,
          maxRedirects: 3,
          deadline: new Date(now.getTime() + 30).toISOString(),
          requestId: `deadline-${blockedStage}`,
        },
        key,
        now,
      });
      let fetches = 0;
      let aborted = false;
      const handler = createResearchRelayHandler({
        allowanceKeys: keys,
        resultKey: key,
        now: () => new Date(),
        replayGuard: claimOnce(),
        searchTool: {
          async invoke({ signal }) {
            if (blockedStage !== 'search') throw new Error('must not search');
            await rejectWhenAborted(signal, () => {
              aborted = true;
            });
          },
        },
        transport: {
          async get(target) {
            fetches += 1;
            return {
              status: 'ok',
              finalUrl: target,
              body: 'ephemeral fixture',
              requestCount: 1,
              redirectsFollowed: 0,
            };
          },
        },
        extractor: {
          async extract({ signal }) {
            if (blockedStage !== 'extractor') return expectedProposal;
            await rejectWhenAborted(signal, () => {
              aborted = true;
            });
          },
        },
      });

      assert.deepEqual(await handler.handle(allowance, phaseInput), {
        status: 'rejected',
        reason: 'deadline',
      });
      assert.equal(aborted, true);
      assert.equal(fetches, blockedStage === 'search' ? 0 : 1);
    }
  },
);

test('Relay confirm uses only exact sorted preview URLs and never calls search', async () => {
  const urls = [
    'https://restaurant.example/reservations',
    'https://tabelog.com/tokyo/A1307/A130701/13000001/',
  ].sort();
  const allowance = await signedAllowance({
    phase: 'confirm',
    requestId: 'confirm-request',
    queryOrUrlsDigest: await confirmInputDigest(urls),
  });
  let searchCalls = 0;
  const handler = createResearchRelayHandler({
    allowanceKeys: keys,
    resultKey: key,
    now: () => initialNow,
    replayGuard: claimOnce(),
    searchTool: {
      async invoke() {
        searchCalls += 1;
        throw new Error('confirm must not search');
      },
    },
    transport: fixtureTransport([]),
    extractor: fixtureExtractor([], confirmSubject),
  });
  assert.deepEqual(
    await handler.handle(allowance, {
      ...confirmPhaseInput(urls),
      subject: { ...confirmSubject, placeId: 'other-branch' },
    }),
    { status: 'rejected', reason: 'payload_mismatch' },
  );
  const result = await handler.handle(allowance, confirmPhaseInput(urls));

  assert.equal(result.status, 'ok');
  assert.equal(searchCalls, 0);
  assert.equal(
    (
      await verifyResearchResult(result.result, {
        keys,
        now: initialNow,
        allowance: allowance.allowance,
        allowanceDigest: allowance.allowanceDigest,
      })
    ).usage.searchQueries,
    0,
  );
});

test('Relay rejects phase payload substitution and signs unavailable for expanded or failed search but observed unknown for benign empty search', async () => {
  const query = '鮨 さいとう';
  const allowance = await signedAllowance({
    phase: 'initial',
    requestId: 'closed-failure',
    queryOrUrlsDigest: await deriveCatalogIntakeResearchInputDigest({
      phase: 'initial',
      normalizedOwnerQuery: query,
    }),
  });
  let claims = 0;
  let searches = 0;
  const handler = createResearchRelayHandler({
    allowanceKeys: keys,
    resultKey: key,
    now: () => initialNow,
    replayGuard: {
      async claim() {
        claims += 1;
        return { kind: 'claimed' };
      },
      async cleanup() {
        return 0;
      },
    },
    searchTool: {
      async invoke() {
        searches += 1;
        return { urls: [], snippets: ['forbidden raw result'] };
      },
    },
    transport: fixtureTransport([]),
    extractor: fixtureExtractor([]),
  });

  assert.deepEqual(
    await handler.handle(allowance, {
      phase: 'initial',
      query: '銀座 天ぷら',
    }),
    { status: 'rejected', reason: 'payload_mismatch' },
  );
  assert.equal(claims, 0);
  assert.equal(searches, 0);

  const closed = await handler.handle(allowance, { phase: 'initial', query });
  assert.equal(closed.status, 'ok');
  const verified = await verifyResearchResult(closed.result, {
    keys,
    now: initialNow,
    allowance: allowance.allowance,
    allowanceDigest: allowance.allowanceDigest,
  });
  assert.deepEqual(verified.outcome, { kind: 'unavailable' });
  assert.equal(claims, 1);
  assert.equal(searches, 1);

  for (const searchResult of [
    { urls: [] },
    new Error('private search failure'),
  ]) {
    const benign = searchResult instanceof Error ? false : true;
    const nextAllowance = await signedAllowance({
      phase: 'initial',
      requestId: benign ? 'empty-search' : 'failed-search',
      queryOrUrlsDigest: await deriveCatalogIntakeResearchInputDigest({
        phase: 'initial',
        normalizedOwnerQuery: query,
      }),
    });
    const nextHandler = createResearchRelayHandler({
      allowanceKeys: keys,
      resultKey: key,
      now: () => initialNow,
      replayGuard: claimOnce(),
      searchTool: {
        async invoke() {
          if (searchResult instanceof Error) throw searchResult;
          return searchResult;
        },
      },
      transport: fixtureTransport([]),
      extractor: fixtureExtractor([]),
    });
    const next = await nextHandler.handle(nextAllowance, {
      phase: 'initial',
      query,
    });
    const nextVerified = await verifyResearchResult(next.result, {
      keys,
      now: initialNow,
      allowance: nextAllowance.allowance,
      allowanceDigest: nextAllowance.allowanceDigest,
    });
    assert.deepEqual(
      nextVerified.outcome,
      benign
        ? {
            kind: 'observed',
            proposal: {
              tabelog: { status: 'unknown' },
              reservation: { status: 'unknown' },
            },
          }
        : { kind: 'unavailable' },
    );
  }
});

test('Relay stops the phase on blocked providers but continues only explicit benign no-evidence', async () => {
  const urls = [
    'https://restaurant-a.example/reservations',
    'https://restaurant-b.example/reservations',
  ];
  for (const reason of [
    'page_blocked',
    'rate_limited',
    'unavailable',
    'security_blocked',
    'conflict',
  ]) {
    const allowance = await signedAllowance({
      phase: 'confirm',
      requestId: `stop-${reason}`,
      queryOrUrlsDigest: await confirmInputDigest(urls),
    });
    let fetches = 0;
    const handler = createResearchRelayHandler({
      allowanceKeys: keys,
      resultKey: key,
      now: () => initialNow,
      replayGuard: claimOnce(),
      searchTool: {
        async invoke() {
          throw new Error('must not search');
        },
      },
      transport: {
        async get() {
          fetches += 1;
          return {
            status: 'failed',
            reason,
            requestCount: 2,
            redirectsFollowed: 1,
          };
        },
      },
      extractor: fixtureExtractor([]),
    });
    const result = await handler.handle(allowance, confirmPhaseInput(urls));
    assert.equal(fetches, 1, reason);
    const verified = await verifyResearchResult(result.result, {
      keys,
      now: initialNow,
      allowance: allowance.allowance,
      allowanceDigest: allowance.allowanceDigest,
    });
    assert.deepEqual(verified.usage, {
      searchQueries: 0,
      pageRequests: 1,
      elapsedMs: 0,
      maximumRedirectsFollowed: 1,
    });
    assert.deepEqual(verified.outcome, { kind: 'unavailable' });
  }

  const allowance = await signedAllowance({
    phase: 'confirm',
    requestId: 'benign-no-evidence',
    queryOrUrlsDigest: await confirmInputDigest(urls),
  });
  let fetches = 0;
  const handler = createResearchRelayHandler({
    allowanceKeys: keys,
    resultKey: key,
    now: () => initialNow,
    replayGuard: claimOnce(),
    searchTool: {
      async invoke() {
        throw new Error('must not search');
      },
    },
    transport: {
      async get(url) {
        fetches += 1;
        return fetches === 1
          ? {
              status: 'failed',
              reason: 'no_evidence',
              requestCount: 1,
              redirectsFollowed: 0,
            }
          : {
              status: 'ok',
              finalUrl: url,
              body: 'ephemeral',
              requestCount: 1,
              redirectsFollowed: 0,
            };
      },
    },
    extractor: {
      async extract({ canonicalUrl }) {
        return {
          status: 'proposal',
          proposal: {
            tabelog: { status: 'unknown' },
            reservation: {
              status: 'known',
              mode: 'reservable',
              label: 'Reservations available',
              url: canonicalUrl,
            },
          },
        };
      },
    },
  });
  const result = await handler.handle(allowance, confirmPhaseInput(urls));
  assert.equal(fetches, 2);
  assert.equal(
    (
      await verifyResearchResult(result.result, {
        keys,
        now: initialNow,
        allowance: allowance.allowance,
        allowanceDigest: allowance.allowanceDigest,
      })
    ).outcome.proposal.reservation.status,
    'known',
  );

  const allNoEvidenceAllowance = await signedAllowance({
    phase: 'confirm',
    requestId: 'all-benign-no-evidence',
    queryOrUrlsDigest: await confirmInputDigest(urls),
  });
  const allNoEvidenceHandler = createResearchRelayHandler({
    allowanceKeys: keys,
    resultKey: key,
    now: () => initialNow,
    replayGuard: claimOnce(),
    searchTool: {
      async invoke() {
        throw new Error('must not search');
      },
    },
    transport: {
      async get() {
        return {
          status: 'failed',
          reason: 'no_evidence',
          requestCount: 1,
          redirectsFollowed: 0,
        };
      },
    },
    extractor: fixtureExtractor([]),
  });
  const allNoEvidence = await allNoEvidenceHandler.handle(
    allNoEvidenceAllowance,
    confirmPhaseInput(urls),
  );
  assert.deepEqual(
    (
      await verifyResearchResult(allNoEvidence.result, {
        keys,
        now: initialNow,
        allowance: allNoEvidenceAllowance.allowance,
        allowanceDigest: allNoEvidenceAllowance.allowanceDigest,
      })
    ).outcome,
    {
      kind: 'observed',
      proposal: {
        tabelog: { status: 'unknown' },
        reservation: { status: 'unknown' },
      },
    },
  );
});

test('Relay extractor stop is terminal while explicit no-evidence alone may continue', async () => {
  const urls = [
    'https://restaurant-a.example/reservations',
    'https://restaurant-b.example/reservations',
  ];
  for (const firstExtraction of [
    ...[
      'page_blocked',
      'rate_limited',
      'unavailable',
      'security_blocked',
      'conflict',
    ].map((reason) => ({ status: 'stop', reason })),
    { status: 'no_evidence' },
  ]) {
    const allowance = await signedAllowance({
      phase: 'confirm',
      requestId: `extract-${firstExtraction.reason ?? firstExtraction.status}`,
      queryOrUrlsDigest: await confirmInputDigest(urls),
    });
    let extractions = 0;
    const handler = createResearchRelayHandler({
      allowanceKeys: keys,
      resultKey: key,
      now: () => initialNow,
      replayGuard: claimOnce(),
      searchTool: {
        async invoke() {
          throw new Error('must not search');
        },
      },
      transport: fixtureTransport([]),
      extractor: {
        async extract({ canonicalUrl }) {
          extractions += 1;
          return extractions === 1
            ? firstExtraction
            : {
                status: 'proposal',
                proposal: {
                  tabelog: { status: 'unknown' },
                  reservation: {
                    status: 'known',
                    mode: 'reservable',
                    label: 'Reservations available',
                    url: canonicalUrl,
                  },
                },
              };
        },
      },
    });
    const result = await handler.handle(allowance, confirmPhaseInput(urls));
    assert.equal(
      extractions,
      firstExtraction.status === 'stop' ? 1 : 2,
      firstExtraction.status,
    );
    const verified = await verifyResearchResult(result.result, {
      keys,
      now: initialNow,
      allowance: allowance.allowance,
      allowanceDigest: allowance.allowanceDigest,
    });
    assert.deepEqual(
      verified.outcome,
      firstExtraction.status === 'stop'
        ? { kind: 'unavailable' }
        : {
            kind: 'observed',
            proposal: {
              tabelog: { status: 'unknown' },
              reservation: {
                status: 'known',
                mode: 'reservable',
                label: 'Reservations available',
                url: urls[1],
              },
            },
          },
    );
  }
});

test('Relay discards partial evidence and signs unavailable when a later extraction throws', async () => {
  const urls = [
    'https://restaurant-a.example/reservations',
    'https://restaurant-b.example/reservations',
  ];
  const allowance = await signedAllowance({
    phase: 'confirm',
    requestId: 'partial-then-failure',
    queryOrUrlsDigest: await confirmInputDigest(urls),
  });
  let extractions = 0;
  const handler = createResearchRelayHandler({
    allowanceKeys: keys,
    resultKey: key,
    now: () => initialNow,
    replayGuard: claimOnce(),
    searchTool: {
      async invoke() {
        throw new Error('must not search');
      },
    },
    transport: fixtureTransport([]),
    extractor: {
      async extract({ canonicalUrl }) {
        extractions += 1;
        if (extractions === 2) throw new Error('private extractor failure');
        return {
          status: 'proposal',
          proposal: {
            tabelog: { status: 'unknown' },
            reservation: {
              status: 'known',
              mode: 'reservable',
              label: 'Reservations available',
              url: canonicalUrl,
            },
          },
        };
      },
    },
  });

  const result = await handler.handle(allowance, confirmPhaseInput(urls));
  const verified = await verifyResearchResult(result.result, {
    keys,
    now: initialNow,
    allowance: allowance.allowance,
    allowanceDigest: allowance.allowanceDigest,
  });
  assert.equal(extractions, 2);
  assert.deepEqual(verified.outcome, { kind: 'unavailable' });
  assert.doesNotMatch(
    JSON.stringify(result),
    /Reservations available|private/u,
  );
});

test('Relay rejects replaying an allowance against a different selected branch', async () => {
  const selected = {
    ownerQuery: '東京麺通団',
    providerNamespace: 'google-places',
    placeId: 'branch-a',
    transientName: 'Tōkyō Mentsūdan',
    transientAddress: 'Shinjuku, Tokyo',
  };
  const allowance = await signedAllowance({
    phase: 'initial',
    requestId: 'selected-branch-request',
    queryOrUrlsDigest: await deriveCatalogIntakeResearchInputDigest({
      phase: 'initial',
      selectedSubject: selected,
    }),
  });
  let claims = 0;
  const handler = createResearchRelayHandler({
    allowanceKeys: keys,
    resultKey: key,
    now: () => initialNow,
    replayGuard: {
      async claim() {
        claims += 1;
        return { kind: 'claimed' };
      },
      async cleanup() {
        return 0;
      },
    },
    searchTool: {
      async invoke() {
        throw new Error('must not search');
      },
    },
    transport: {
      async get() {
        throw new Error('must not fetch');
      },
    },
    extractor: {
      async extract() {
        throw new Error('must not extract');
      },
    },
  });

  assert.deepEqual(
    await handler.handle(allowance, {
      phase: 'initial',
      subject: { ...selected, placeId: 'branch-b' },
    }),
    { status: 'rejected', reason: 'payload_mismatch' },
  );
  assert.equal(claims, 0);
});

function confirmPhaseInput(canonicalUrls) {
  return { phase: 'confirm', canonicalUrls, subject: confirmSubject };
}

function confirmInputDigest(canonicalUrls) {
  return deriveCatalogIntakeResearchInputDigest({
    phase: 'confirm',
    canonicalUrls,
    selectedSubject: confirmSubject,
  });
}

async function signedAllowance({ phase, requestId, queryOrUrlsDigest }) {
  const maxDurationMs = phase === 'initial' ? 35_000 : 25_000;
  return signResearchAllowance({
    allowance: {
      sessionId: 'session-1',
      phase,
      queryOrUrlsDigest,
      maxCounts: {
        searchQueries: phase === 'initial' ? 1 : 0,
        pageRequests: phase === 'initial' ? 3 : 2,
      },
      maxDurationMs,
      requestTimeoutMs: 15_000,
      maxRedirects: 3,
      deadline: new Date(initialNow.getTime() + maxDurationMs).toISOString(),
      requestId,
    },
    key,
    now: initialNow,
  });
}

function claimOnce() {
  return {
    async claim() {
      return { kind: 'claimed' };
    },
    async cleanup() {
      return 0;
    },
  };
}

function fixtureTransport(events) {
  return {
    async get(url) {
      const hostname = new URL(url).hostname;
      events.push(`fetch:${hostname}`);
      return {
        status: 'ok',
        finalUrl: url,
        body: `fixture body for ${hostname}`,
        requestCount: hostname === 'tabelog.com' ? 2 : 1,
        redirectsFollowed: hostname === 'tabelog.com' ? 1 : 0,
      };
    },
  };
}

function fixtureExtractor(events, expectedSubject) {
  return {
    async extract({ canonicalUrl, subject }) {
      if (expectedSubject) assert.deepEqual(subject, expectedSubject);
      const hostname = new URL(canonicalUrl).hostname;
      events.push(`extract:${hostname}`);
      return {
        status: 'proposal',
        proposal:
          hostname === 'tabelog.com'
            ? {
                tabelog: expectedProposal.tabelog,
                reservation: { status: 'unknown' },
              }
            : {
                tabelog: { status: 'unknown' },
                reservation: expectedProposal.reservation,
              },
      };
    },
  };
}

const expectedProposal = {
  tabelog: {
    status: 'known',
    score: 4.2,
    reviewCount: 100,
    url: 'https://tabelog.com/tokyo/A1307/A130701/13000001/',
  },
  reservation: {
    status: 'known',
    mode: 'reservation_required',
    label: 'Reservation required',
    advanceDays: 7,
    url: 'https://restaurant.example/reservations',
  },
};

function rejectWhenAborted(signal, onAbort) {
  return new Promise((resolve, reject) => {
    signal.addEventListener(
      'abort',
      () => {
        onAbort();
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
