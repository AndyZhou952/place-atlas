import assert from 'node:assert/strict';
import test from 'node:test';

import { createOpenClawGatewayResearchAdapters } from './openclaw-gateway-research-adapter.ts';
import { createTabelogResearchSourcePolicy } from './research-source-policy.ts';

const detailUrl = 'https://tabelog.com/tokyo/A1307/A130701/13000001/';

test('OpenClaw research adapter keeps Gateway access loopback-only and returns only allowlisted detail URLs', async () => {
  assert.throws(
    () =>
      createOpenClawGatewayResearchAdapters({
        endpoint: 'https://gateway.example/tools/invoke',
        token: 'secret',
        sourcePolicy: createTabelogResearchSourcePolicy(),
      }),
    /configuration is invalid/u,
  );
  const calls = [];
  const adapters = createAdapters(async (_url, init) => {
    calls.push(JSON.parse(init.body));
    return jsonResponse({
      ok: true,
      result: {
        details: {
          kind: 'results',
          provider: 'duckduckgo',
          query: 'fixture',
          count: 4,
          results: [
            { title: 'right', url: `${detailUrl}?tracking=1` },
            { title: 'duplicate', url: detailUrl },
            {
              title: 'search page',
              url: 'https://tabelog.com/tokyo/rstLst/',
            },
            { title: 'host confusion', url: 'https://tabelog.com.evil.test/x' },
          ],
          externalContent: {
            untrusted: true,
            source: 'web_search',
            wrapped: true,
            provider: 'duckduckgo',
          },
        },
      },
    });
  });
  const result = await adapters.searchTool.invoke({
    toolId: 'openclaw.web_search',
    toolVersion: 'v1',
    arguments: {
      query: 'Sushi Saito Roppongi',
      maxResults: 3,
      output: 'url_candidates_only',
    },
    signal: new AbortController().signal,
    deadlineAtMs: Date.now() + 5_000,
  });
  assert.deepEqual(result, { urls: [detailUrl] });
  assert.deepEqual(calls, [
    {
      tool: 'web_search',
      args: {
        query: 'Sushi Saito Roppongi site:tabelog.com',
        count: 3,
      },
    },
  ]);
});

test('OpenClaw fetch uses structured web_fetch details and fails closed on redirects or non-policy URLs', async () => {
  let finalUrl = detailUrl;
  const adapters = createAdapters(async (_url, init) => {
    const request = JSON.parse(init.body);
    assert.deepEqual(request, {
      tool: 'web_fetch',
      args: { url: detailUrl, extractMode: 'text', maxChars: 64_000 },
    });
    return jsonResponse({
      ok: true,
      result: {
        details: {
          url: detailUrl,
          finalUrl,
          status: 200,
          extractMode: 'text',
          extractor: 'readability',
          externalContent: {
            untrusted: true,
            source: 'web_fetch',
            wrapped: true,
          },
          truncated: false,
          length: 12,
          rawLength: 12,
          fetchedAt: new Date().toISOString(),
          tookMs: 10,
          text: 'score is 3.9',
        },
      },
    });
  });
  const limits = {
    timeoutMs: 3_000,
    maxRedirects: 3,
    deadlineAtMs: Date.now() + 5_000,
  };
  assert.deepEqual(await adapters.transport.get(detailUrl, limits), {
    status: 'ok',
    finalUrl: detailUrl,
    body: 'score is 3.9',
    requestCount: 1,
    redirectsFollowed: 0,
  });
  finalUrl = 'https://www.tabelog.com/tokyo/A1307/A130701/13000001/';
  assert.deepEqual(await adapters.transport.get(detailUrl, limits), {
    status: 'failed',
    reason: 'security_blocked',
    requestCount: 0,
    redirectsFollowed: 0,
  });
  assert.deepEqual(
    await adapters.transport.get('https://example.com/private', limits),
    {
      status: 'failed',
      reason: 'security_blocked',
      requestCount: 0,
      redirectsFollowed: 0,
    },
  );
});

test('Tabelog source policy accepts only canonical restaurant detail pages', () => {
  const policy = createTabelogResearchSourcePolicy();
  assert.equal(
    policy.canonicalize(`${detailUrl}?from=search#ignored`),
    undefined,
  );
  assert.equal(policy.canonicalize(`${detailUrl}?from=search`), detailUrl);
  assert.equal(
    policy.canonicalize('https://tabelog.com/tw/osaka/A2701/A270101/27115113/'),
    'https://tabelog.com/tw/osaka/A2701/A270101/27115113/',
  );
  for (const denied of [
    'http://tabelog.com/tokyo/A1307/A130701/13000001/',
    'https://evil.tabelog.com/tokyo/A1307/A130701/13000001/',
    'https://tabelog.com/tokyo/rstLst/',
    'https://tabelog.com/users/example/',
  ]) {
    assert.equal(policy.canonicalize(denied), undefined, denied);
  }
});

function createAdapters(fetchImpl) {
  return createOpenClawGatewayResearchAdapters({
    endpoint: 'http://127.0.0.1:18789/tools/invoke',
    token: 'gateway-secret',
    sourcePolicy: createTabelogResearchSourcePolicy(),
    fetch: fetchImpl,
  });
}

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
