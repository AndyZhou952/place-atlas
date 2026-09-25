import assert from 'node:assert/strict';
import test from 'node:test';

import { createHardenedResearchTransport as createPolicyBoundedTransport } from './hardened-research-transport.ts';
import { createTabelogResearchSourcePolicy } from './research-source-policy.ts';

const fixtureSourcePolicy = {
  canonicalize: canonicalHttps,
  authorizeCandidate: canonicalHttps,
  authorizeRedirect(_from, to) {
    return canonicalHttps(to);
  },
  authorizeClaim(_kind, url) {
    return canonicalHttps(url);
  },
};

function createHardenedResearchTransport(dependencies) {
  return createPolicyBoundedTransport({
    ...dependencies,
    sourcePolicy: fixtureSourcePolicy,
  });
}

function canonicalHttps(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

test('hardened research transport pins public dual-stack DNS and preserves hostname TLS across redirects', async () => {
  const calls = [];
  const dns = {
    async resolve(hostname) {
      return hostname === 'tabelog.com'
        ? dnsAnswer(['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'])
        : dnsAnswer(['93.184.216.35']);
    },
  };
  const connector = {
    async request(input) {
      calls.push(input);
      return calls.length === 1
        ? {
            status: 302,
            headers: {
              location: 'https://www.tabelog.com/tokyo/A1301/A130101/13000001/',
            },
            connectedIp: input.pinnedIp,
            body: bodyOf(''),
          }
        : {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
            connectedIp: input.pinnedIp,
            body: bodyOf('<html>ephemeral fixture</html>'),
          };
    },
  };
  const transport = createHardenedResearchTransport({ dns, connector });

  assert.deepEqual(
    await transport.get('https://tabelog.com/tokyo/A1301/A130101/13000001/', {
      timeoutMs: 15_000,
      maxRedirects: 3,
      deadlineAtMs: 4_000_000_000_000,
    }),
    {
      status: 'ok',
      finalUrl: 'https://www.tabelog.com/tokyo/A1301/A130101/13000001/',
      body: '<html>ephemeral fixture</html>',
      requestCount: 2,
      redirectsFollowed: 1,
    },
  );
  assert.deepEqual(
    calls.map(({ pinnedIp, tlsServerName, hostHeader, timeoutMs }) => ({
      pinnedIp,
      tlsServerName,
      hostHeader,
      timeoutMs,
    })),
    [
      {
        pinnedIp: '2606:2800:220:1:248:1893:25c8:1946',
        tlsServerName: 'tabelog.com',
        hostHeader: 'tabelog.com',
        timeoutMs: 15_000,
      },
      {
        pinnedIp: '93.184.216.35',
        tlsServerName: 'www.tabelog.com',
        hostHeader: 'www.tabelog.com',
        timeoutMs: 15_000,
      },
    ],
  );
});

test('source policy blocks a redirect before its hostname reaches DNS', async () => {
  const dnsHosts = [];
  const transport = createPolicyBoundedTransport({
    sourcePolicy: createTabelogResearchSourcePolicy(),
    dns: {
      async resolve(hostname) {
        dnsHosts.push(hostname);
        return dnsAnswer(['93.184.216.34']);
      },
    },
    connector: {
      async request(input) {
        return {
          status: 302,
          headers: { location: 'https://restaurant.example/reservations' },
          connectedIp: input.pinnedIp,
          body: bodyOf(''),
        };
      },
    },
  });
  assert.deepEqual(
    await transport.get('https://tabelog.com/tokyo/A1301/A130101/13000001/', {
      timeoutMs: 15_000,
      maxRedirects: 3,
      deadlineAtMs: 4_000_000_000_000,
    }),
    {
      status: 'failed',
      reason: 'security_blocked',
      requestCount: 1,
      redirectsFollowed: 1,
    },
  );
  assert.deepEqual(dnsHosts, ['tabelog.com']);
});

test('source policy rejects a redirect to a different Tabelog restaurant identity', () => {
  const policy = createTabelogResearchSourcePolicy();
  assert.equal(
    policy.authorizeRedirect(
      'https://tabelog.com/tokyo/A1301/A130101/13000001/',
      'https://www.tabelog.com/tokyo/A1301/A130101/13000002/',
    ),
    undefined,
  );
  assert.equal(
    policy.authorizeRedirect(
      'https://tabelog.com/tokyo/A1301/A130101/13000001/',
      'https://www.tabelog.com/tw/tokyo/A1301/A130101/13000001/',
    ),
    'https://www.tabelog.com/tw/tokyo/A1301/A130101/13000001/',
  );
});

test('hardened research transport rejects unsafe URLs, any bad A/AAAA answer, rebinding, and redirect escape', async () => {
  let connectorCalls = 0;
  const connector = {
    async request(input) {
      connectorCalls += 1;
      return {
        status: 200,
        headers: {},
        connectedIp: input.pinnedIp,
        body: 'fixture',
      };
    },
  };
  for (const url of [
    'http://tabelog.com/path',
    'https://user:pass@tabelog.com/path',
    'https://tabelog.com:444/path',
    'https://127.0.0.1/path',
    'https://[::1]/path',
    'https://metadata.google.internal/path',
    'https://tabelog.com/path#fragment',
  ]) {
    const transport = createHardenedResearchTransport({
      dns: {
        async resolve() {
          return dnsAnswer(['93.184.216.34']);
        },
      },
      connector,
    });
    assertFailure(await transport.get(url, limits), 'security_blocked');
  }
  assert.equal(connectorCalls, 0);

  for (const addresses of [
    ['10.0.0.1'],
    ['100.64.0.1'],
    ['169.254.169.254'],
    ['172.16.0.1'],
    ['192.168.0.1'],
    ['224.0.0.1'],
    ['0.0.0.0'],
    ['fc00::1'],
    ['fe80::1'],
    ['ff02::1'],
    ['::'],
    ['::ffff:127.0.0.1'],
    ['93.184.216.34', '::1'],
  ]) {
    const transport = createHardenedResearchTransport({
      dns: {
        async resolve() {
          return dnsAnswer(addresses);
        },
      },
      connector,
    });
    assertFailure(
      await transport.get('https://restaurant.example/path', limits),
      'security_blocked',
      addresses.join(','),
    );
  }
  assert.equal(connectorCalls, 0);

  const rebound = createHardenedResearchTransport({
    dns: {
      async resolve() {
        return dnsAnswer(['93.184.216.34']);
      },
    },
    connector: {
      async request() {
        return {
          status: 200,
          headers: {},
          connectedIp: '127.0.0.1',
          body: 'fixture',
        };
      },
    },
  });
  assertFailure(
    await rebound.get('https://restaurant.example/path', limits),
    'malformed',
  );

  const redirected = createHardenedResearchTransport({
    dns: {
      async resolve(hostname) {
        return hostname === 'restaurant.example'
          ? dnsAnswer(['93.184.216.34'])
          : dnsAnswer(['169.254.169.254']);
      },
    },
    connector: {
      async request(input) {
        return {
          status: 302,
          headers: { location: 'https://metadata.example/latest/meta-data' },
          connectedIp: input.pinnedIp,
          body: '',
        };
      },
    },
  });
  assertFailure(
    await redirected.get('https://restaurant.example/path', limits),
    'malformed',
  );
});

test('hardened research transport fails closed on DNS, response, and redirect ambiguity', async () => {
  for (const dns of [
    {
      async resolve() {
        return dnsAnswer([]);
      },
    },
    {
      async resolve() {
        return {
          a: { status: 'failure' },
          aaaa: { status: 'nodata' },
        };
      },
    },
    {
      async resolve() {
        throw new Error('fixture DNS failure');
      },
    },
  ]) {
    let called = false;
    const transport = createHardenedResearchTransport({
      dns,
      connector: {
        async request() {
          called = true;
          throw new Error('must not connect');
        },
      },
    });
    assertFailure(
      await transport.get('https://restaurant.example/path', limits),
    );
    assert.equal(called, false);
  }

  for (const response of [
    {
      status: 200,
      headers: {},
      connectedIp: '93.184.216.35',
      body: 'wrong peer',
    },
    { status: 302, headers: {}, connectedIp: '93.184.216.34', body: '' },
    {
      status: 302,
      headers: { location: 42 },
      connectedIp: '93.184.216.34',
      body: '',
    },
    { status: 99, headers: {}, connectedIp: '93.184.216.34', body: '' },
    { status: 200, headers: [], connectedIp: '93.184.216.34', body: '' },
  ]) {
    const transport = createHardenedResearchTransport({
      dns: {
        async resolve() {
          return dnsAnswer(['93.184.216.34']);
        },
      },
      connector: {
        async request() {
          return response;
        },
      },
    });
    assertFailure(
      await transport.get('https://restaurant.example/path', limits),
    );
  }

  for (const location of [
    'http://restaurant.example/downgrade',
    'https://user:pass@restaurant.example/secret',
    'https://restaurant.example:444/wrong-port',
    'https://127.0.0.1/private',
  ]) {
    const transport = createHardenedResearchTransport({
      dns: {
        async resolve() {
          return dnsAnswer(['93.184.216.34']);
        },
      },
      connector: {
        async request(input) {
          return {
            status: 302,
            headers: { location },
            connectedIp: input.pinnedIp,
            body: '',
          };
        },
      },
    });
    assertFailure(
      await transport.get('https://restaurant.example/path', limits),
    );
  }
});

test('hardened research transport maps provider stops to closed reasons with actual usage', async () => {
  for (const [status, reason] of [
    [404, 'no_evidence'],
    [403, 'page_blocked'],
    [409, 'conflict'],
    [429, 'rate_limited'],
    [503, 'unavailable'],
  ]) {
    const transport = createHardenedResearchTransport({
      dns: {
        async resolve() {
          return dnsAnswer(['93.184.216.34']);
        },
      },
      connector: {
        async request(input) {
          return {
            status,
            headers: {},
            connectedIp: input.pinnedIp,
            body: bodyOf('must not be exposed'),
          };
        },
      },
    });

    assert.deepEqual(
      await transport.get('https://restaurant.example/path', limits),
      {
        status: 'failed',
        reason,
        requestCount: 1,
        redirectsFollowed: 0,
      },
    );
  }
});

test('hardened research transport permits relative redirects but rejects a fourth hop without making it', async () => {
  let requests = 0;
  const transport = createHardenedResearchTransport({
    dns: {
      async resolve() {
        return dnsAnswer(['93.184.216.34']);
      },
    },
    connector: {
      async request(input) {
        requests += 1;
        return requests < 5
          ? {
              status: 302,
              headers: { location: `/hop-${requests}` },
              connectedIp: input.pinnedIp,
              body: bodyOf(''),
            }
          : {
              status: 200,
              headers: {},
              connectedIp: input.pinnedIp,
              body: bodyOf('must not reach'),
            };
      },
    },
  });

  assert.deepEqual(
    await transport.get('https://restaurant.example/start', limits),
    {
      status: 'failed',
      reason: 'security_blocked',
      requestCount: 4,
      redirectsFollowed: 3,
    },
  );
  assert.equal(requests, 4);

  requests = 0;
  const oneHop = createHardenedResearchTransport({
    dns: {
      async resolve() {
        return dnsAnswer(['93.184.216.34']);
      },
    },
    connector: {
      async request(input) {
        requests += 1;
        return requests === 1
          ? {
              status: 302,
              headers: { location: '/final' },
              connectedIp: input.pinnedIp,
              body: bodyOf(''),
            }
          : {
              status: 200,
              headers: { 'content-type': 'text/html; charset=utf-8' },
              connectedIp: input.pinnedIp,
              body: bodyOf('ok'),
            };
      },
    },
  });
  assert.deepEqual(
    await oneHop.get('https://restaurant.example/start', limits),
    {
      status: 'ok',
      finalUrl: 'https://restaurant.example/final',
      body: 'ok',
      requestCount: 2,
      redirectsFollowed: 1,
    },
  );
});

test('hardened research transport bounds headers, streaming bytes, encoding, charset, and phase deadline', async () => {
  for (const headers of [
    { 'content-type': 'image/png' },
    { 'content-type': 'text/html; charset=shift_jis' },
    { 'content-type': 'text/html; charset=utf-8', 'content-encoding': 'gzip' },
    { 'content-type': 'text/html; charset=utf-8', 'content-length': '1000001' },
    { 'content-type': ['text/html'] },
    { 'x-large': 'x'.repeat(32_769), 'content-type': 'text/html' },
  ]) {
    const transport = fixtureTransport({ headers, body: bodyOf('fixture') });
    assertFailure(
      await transport.get('https://restaurant.example/path', limits),
    );
  }

  const oversized = fixtureTransport({
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: bodyOf('x'.repeat(1_000_001)),
  });
  assertFailure(await oversized.get('https://restaurant.example/path', limits));

  let now = 10_000;
  let observedTimeout;
  const slow = createHardenedResearchTransport({
    now: () => now,
    dns: {
      async resolve() {
        return dnsAnswer(['93.184.216.34']);
      },
    },
    connector: {
      async request(input) {
        observedTimeout = input.timeoutMs;
        return {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
          connectedIp: input.pinnedIp,
          body: {
            async *[Symbol.asyncIterator]() {
              now = 15_001;
              yield new TextEncoder().encode('too late');
            },
          },
        };
      },
    },
  });
  assertFailure(
    await slow.get('https://restaurant.example/path', {
      timeoutMs: 15_000,
      maxRedirects: 3,
      deadlineAtMs: 15_000,
    }),
    'deadline',
  );
  assert.equal(observedTimeout, 5_000);

  const aborted = fixtureTransport({
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            throw new DOMException('fixture abort', 'AbortError');
          },
        };
      },
    },
  });
  assertFailure(await aborted.get('https://restaurant.example/path', limits));
});

test(
  'hardened research transport cooperatively aborts DNS, connector, and stream and recomputes remaining time',
  { timeout: 2_000 },
  async () => {
    for (const blockedStage of ['dns', 'connector', 'stream']) {
      let aborted = false;
      let streamClosed = false;
      const deadlineAtMs = Date.now() + 30;
      const transport = createHardenedResearchTransport({
        dns: {
          async resolve(_hostname, { signal }) {
            if (blockedStage === 'dns') {
              await rejectWhenAborted(signal, () => {
                aborted = true;
              });
            }
            return dnsAnswer(['93.184.216.34']);
          },
        },
        connector: {
          async request(input) {
            assert.equal(input.signal instanceof AbortSignal, true);
            if (blockedStage === 'connector') {
              await rejectWhenAborted(input.signal, () => {
                aborted = true;
              });
            }
            return {
              status: 200,
              headers: { 'content-type': 'text/html; charset=utf-8' },
              connectedIp: input.pinnedIp,
              body: {
                async *[Symbol.asyncIterator]() {
                  try {
                    if (blockedStage === 'stream') {
                      await rejectWhenAborted(input.signal, () => {
                        aborted = true;
                      });
                    }
                    yield new TextEncoder().encode('ok');
                  } finally {
                    streamClosed = true;
                  }
                },
              },
            };
          },
        },
      });
      assertFailure(
        await transport.get('https://restaurant.example/path', {
          timeoutMs: 15_000,
          maxRedirects: 3,
          deadlineAtMs,
        }),
        'deadline',
      );
      assert.equal(aborted, true);
      if (blockedStage === 'stream') assert.equal(streamClosed, true);
    }

    const neverSettlingDns = createHardenedResearchTransport({
      dns: {
        async resolve() {
          return new Promise(() => undefined);
        },
      },
      connector: {
        async request() {
          throw new Error('connector must not be reached');
        },
      },
    });
    assertFailure(
      await neverSettlingDns.get('https://restaurant.example/path', {
        timeoutMs: 15_000,
        maxRedirects: 3,
        deadlineAtMs: Date.now() + 30,
      }),
      'deadline',
    );

    let now = 10_000;
    let connectorTimeout;
    const recomputed = createHardenedResearchTransport({
      now: () => now,
      dns: {
        async resolve() {
          now = 12_000;
          return dnsAnswer(['93.184.216.34']);
        },
      },
      connector: {
        async request(input) {
          connectorTimeout = input.timeoutMs;
          return {
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
            connectedIp: input.pinnedIp,
            body: bodyOf('ok'),
          };
        },
      },
    });
    assert.equal(
      (
        await recomputed.get('https://restaurant.example/path', {
          timeoutMs: 15_000,
          maxRedirects: 3,
          deadlineAtMs: 15_000,
        })
      ).status,
      'ok',
    );
    assert.equal(connectorTimeout, 3_000);
  },
);

const limits = {
  timeoutMs: 15_000,
  maxRedirects: 3,
  deadlineAtMs: 4_000_000_000_000,
};

function bodyOf(value) {
  return {
    async *[Symbol.asyncIterator]() {
      yield new TextEncoder().encode(value);
    },
  };
}

function fixtureTransport({ headers, body }) {
  return createHardenedResearchTransport({
    dns: {
      async resolve() {
        return dnsAnswer(['93.184.216.34']);
      },
    },
    connector: {
      async request(input) {
        return { status: 200, headers, connectedIp: input.pinnedIp, body };
      },
    },
  });
}

function dnsAnswer(addresses) {
  const a = addresses.filter((address) => !address.includes(':'));
  const aaaa = addresses.filter((address) => address.includes(':'));
  return {
    a: a.length === 0 ? { status: 'nodata' } : { status: 'ok', addresses: a },
    aaaa:
      aaaa.length === 0
        ? { status: 'nodata' }
        : { status: 'ok', addresses: aaaa },
  };
}

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

function assertFailure(value, reason, message) {
  assert.equal(value.status, 'failed', message);
  if (reason) assert.equal(value.reason, reason, message);
  assert.equal(Number.isInteger(value.requestCount), true, message);
  assert.equal(Number.isInteger(value.redirectsFollowed), true, message);
}
