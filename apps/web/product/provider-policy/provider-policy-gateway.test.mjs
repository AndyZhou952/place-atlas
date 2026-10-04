import assert from 'node:assert/strict';
import test from 'node:test';

import { publicUnicastAddressClassifier as addressClassifier } from '../../adapters/providers/public-unicast-address-classifier.ts';
import { createProviderPolicyGateway } from './provider-policy-gateway.ts';

const activePolicy = {
  schemaVersion: 1,
  policyVersion: 'fixture-2026-09-13',
  providerId: 'fixture',
  status: 'active',
  credentialScopes: ['places.read'],
  origins: ['https://api.example.test'],
  fields: {
    placeId: {
      read: 'allow',
      request: 'allow',
      chat: 'allow',
      prompt: 'deny',
      durable: 'allow',
      leaflet: 'deny',
    },
    name: {
      read: 'allow',
      request: 'allow',
      chat: 'allow',
      prompt: 'deny',
      durable: 'deny',
      leaflet: 'deny',
    },
  },
  attribution: {
    chat: { label: 'Fixture Places', url: 'https://example.test/terms' },
  },
  cache: { crossRequest: 'deny', maximumTtlSeconds: 0 },
  limits: { requests: 10, costUsd: 1 },
};

function request(overrides = {}) {
  return {
    providerId: 'fixture',
    credentialScope: 'places.read',
    url: 'https://api.example.test/search?q=sushi',
    method: 'GET',
    fields: [
      { name: 'placeId', use: 'durable' },
      { name: 'name', use: 'chat' },
    ],
    cache: { mode: 'request_only' },
    estimatedCostUsd: 0.01,
    ...overrides,
  };
}

test('an allowlisted provider request returns only policy-approved fields with attribution', async () => {
  const calls = [];
  const gateway = createProviderPolicyGateway({
    addressClassifier,
    policies: [activePolicy],
    resolve: async (hostname) => {
      assert.equal(hostname, 'api.example.test');
      return ['93.184.216.34'];
    },
    usage: {
      async reserve(reservation) {
        assert.deepEqual(reservation, {
          providerId: 'fixture',
          requests: 1,
          costUsd: 0.01,
          hardRequestLimit: 10,
          hardCostLimitUsd: 1,
        });
        return 'reserved';
      },
    },
    transport: async (providerRequest) => {
      calls.push(providerRequest);
      return {
        status: 200,
        headers: {},
        body: {
          placeId: 'fsq-123',
          name: 'Sushi Example',
          internalDebug: 'must never leave the gateway',
        },
      };
    },
  });

  const result = await gateway.invoke(request());

  assert.deepEqual(result, {
    ok: true,
    value: {
      providerId: 'fixture',
      policyVersion: 'fixture-2026-09-13',
      sourceUrl: 'https://api.example.test/search?q=sushi',
      fields: { placeId: 'fsq-123', name: 'Sushi Example' },
      attribution: {
        label: 'Fixture Places',
        url: 'https://example.test/terms',
      },
      cache: { mode: 'request_only' },
    },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].resolvedAddresses, ['93.184.216.34']);
});

test('DNS results fail closed for loopback, link-local, private, CGNAT, ULA, metadata, and invalid addresses', async () => {
  const blockedAddresses = [
    '127.7.8.9',
    '169.254.42.7',
    '10.1.2.3',
    '172.31.255.1',
    '192.168.1.8',
    '100.64.1.2',
    '169.254.169.254',
    '::1',
    'fe80::1234',
    'fc00::1',
    'fd12:3456::1',
    '::ffff:192.168.1.1',
    '::ffff:7f00:1',
    '0:0:0:0:0:ffff:7f00:1',
    '::FFFF:7F00:1',
    '224.0.0.1',
    '255.255.255.255',
    '192.0.2.1',
    '198.51.100.42',
    '203.0.113.1',
    'ff02::1',
    '2001:db8::1',
    '64:ff9b::7f00:1',
    'not-an-address',
  ];
  let reservations = 0;
  let transports = 0;

  for (const address of blockedAddresses) {
    const gateway = createProviderPolicyGateway({
      addressClassifier,
      policies: [activePolicy],
      resolve: async () => [address],
      usage: {
        async reserve() {
          reservations += 1;
          return 'reserved';
        },
      },
      transport: async () => {
        transports += 1;
        return { status: 200, headers: {}, body: {} };
      },
    });

    const result = await gateway.invoke(request());
    assert.equal(result.ok, false, address);
    if (!result.ok) assert.equal(result.error.kind, 'policy_denied', address);
  }

  assert.equal(reservations, 0);
  assert.equal(transports, 0);
});

test('DNS allows only public unicast results and rejects a mixed public/private answer atomically', async () => {
  const acceptedAddressSets = [
    { resolved: ['93.184.216.34'], transported: ['93.184.216.34'] },
    {
      resolved: ['2001:4860:4860::8888'],
      transported: ['2001:4860:4860::8888'],
    },
    { resolved: ['::ffff:5db8:d822'], transported: ['93.184.216.34'] },
  ];

  for (const addresses of acceptedAddressSets) {
    const transported = [];
    const gateway = createProviderPolicyGateway({
      addressClassifier,
      policies: [activePolicy],
      resolve: async () => addresses.resolved,
      usage: { reserve: async () => 'reserved' },
      transport: async (providerRequest) => {
        transported.push(providerRequest.resolvedAddresses);
        return {
          status: 200,
          headers: {},
          body: { placeId: 'public', name: 'Public endpoint' },
        };
      },
    });

    assert.equal(
      (await gateway.invoke(request())).ok,
      true,
      addresses.resolved[0],
    );
    assert.deepEqual(transported, [addresses.transported]);
  }

  let reservations = 0;
  let transports = 0;
  const mixedGateway = createProviderPolicyGateway({
    addressClassifier,
    policies: [activePolicy],
    resolve: async () => ['93.184.216.34', '::ffff:7f00:1'],
    usage: {
      async reserve() {
        reservations += 1;
        return 'reserved';
      },
    },
    transport: async () => {
      transports += 1;
      return { status: 200, headers: {}, body: {} };
    },
  });

  const mixed = await mixedGateway.invoke(request());
  assert.equal(mixed.ok, false);
  if (!mixed.ok) assert.equal(mixed.error.kind, 'policy_denied');
  assert.equal(reservations, 0);
  assert.equal(transports, 0);
});

test('every redirect hop rechecks origin and DNS before another provider call', async () => {
  const policies = [
    {
      ...activePolicy,
      origins: ['https://api.example.test', 'https://redirect.example.test'],
    },
  ];
  const resolved = [];
  const transported = [];
  const gateway = createProviderPolicyGateway({
    addressClassifier,
    policies,
    resolve: async (hostname) => {
      resolved.push(hostname);
      return hostname === 'redirect.example.test'
        ? ['93.184.216.35']
        : ['93.184.216.34'];
    },
    usage: { reserve: async () => 'reserved' },
    transport: async (providerRequest) => {
      transported.push(providerRequest.url);
      return transported.length === 1
        ? {
            status: 302,
            headers: { location: 'https://redirect.example.test/result' },
            body: {},
          }
        : {
            status: 200,
            headers: {},
            body: { placeId: 'fsq-redirect', name: 'Redirected' },
          };
    },
  });

  const result = await gateway.invoke(request());
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(
      result.value.sourceUrl,
      'https://redirect.example.test/result',
    );
  }
  assert.deepEqual(resolved, ['api.example.test', 'redirect.example.test']);
  assert.equal(transported.length, 2);

  let privateHopCalls = 0;
  const blockedGateway = createProviderPolicyGateway({
    addressClassifier,
    policies,
    resolve: async (hostname) =>
      hostname === 'redirect.example.test' ? ['10.0.0.8'] : ['93.184.216.34'],
    usage: { reserve: async () => 'reserved' },
    transport: async () => {
      privateHopCalls += 1;
      return {
        status: 302,
        headers: { location: 'https://redirect.example.test/result' },
        body: {},
      };
    },
  });
  const blocked = await blockedGateway.invoke(request());
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.error.kind, 'policy_denied');
  assert.equal(privateHopCalls, 1);
});

test('every redirect hop rejects non-unicast and mixed DNS answers before transport', async () => {
  const policies = [
    {
      ...activePolicy,
      origins: ['https://api.example.test', 'https://redirect.example.test'],
    },
  ];

  for (const redirectedAddresses of [
    ['::ffff:7f00:1'],
    ['93.184.216.35', 'ff02::1'],
  ]) {
    let transports = 0;
    const gateway = createProviderPolicyGateway({
      addressClassifier,
      policies,
      resolve: async (hostname) =>
        hostname === 'redirect.example.test'
          ? redirectedAddresses
          : ['93.184.216.34'],
      usage: { reserve: async () => 'reserved' },
      transport: async () => {
        transports += 1;
        return {
          status: 307,
          headers: { location: 'https://redirect.example.test/result' },
          body: {},
        };
      },
    });

    const result = await gateway.invoke(
      request({ method: 'POST', body: { travelMode: 'WALK' } }),
    );
    assert.equal(result.ok, false, redirectedAddresses.join(','));
    if (!result.ok) assert.equal(result.error.kind, 'policy_denied');
    assert.equal(transports, 1, redirectedAddresses.join(','));
  }
});

test('a registered but unlicensed optional rating is not fetched and is returned as unknown', async () => {
  const requestedFields = [];
  const gateway = createProviderPolicyGateway({
    addressClassifier,
    policies: [
      {
        ...activePolicy,
        providerId: 'foursquare',
        policyVersion: 'foursquare-2026-09-13-draft',
        fields: {
          ...activePolicy.fields,
          rating: {
            read: 'pending',
            request: 'pending',
            chat: 'pending',
            prompt: 'deny',
            durable: 'deny',
            leaflet: 'deny',
          },
        },
        attribution: {
          chat: {
            label: 'Foursquare',
            url: 'https://foursquare.com/products/places',
          },
        },
      },
    ],
    resolve: async () => ['93.184.216.34'],
    usage: { reserve: async () => 'reserved' },
    transport: async (providerRequest) => {
      requestedFields.push(...providerRequest.fields);
      return {
        status: 200,
        headers: {},
        body: {
          placeId: 'fsq-123',
          rating: 9.9,
          name: 'Sushi Example',
        },
      };
    },
  });

  const result = await gateway.invoke(
    request({
      providerId: 'foursquare',
      fields: [
        { name: 'placeId', use: 'durable' },
        { name: 'name', use: 'chat' },
        { name: 'rating', use: 'chat', whenDenied: 'unknown' },
      ],
    }),
  );

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.value.fields, {
      placeId: 'fsq-123',
      name: 'Sushi Example',
      rating: { status: 'unknown', reason: 'not_permitted' },
    });
  }

  assert.deepEqual(requestedFields, ['placeId', 'name']);
});
test('metadata hostnames are denied even when misconfigured into the origin allowlist', async () => {
  let transports = 0;
  const gateway = createProviderPolicyGateway({
    addressClassifier,
    policies: [
      {
        ...activePolicy,
        origins: ['https://metadata.google.internal'],
      },
    ],
    resolve: async () => ['93.184.216.34'],
    usage: { reserve: async () => 'reserved' },
    transport: async () => {
      transports += 1;
      return { status: 200, headers: {}, body: {} };
    },
  });

  const result = await gateway.invoke(
    request({ url: 'https://metadata.google.internal/computeMetadata/v1/' }),
  );

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, 'policy_denied');
  assert.equal(transports, 0);
});

test('policy, destination, field, attribution, cache, and cost gates fail closed before transport', async () => {
  const cases = [
    {
      name: 'terms review is pending',
      policy: { ...activePolicy, status: 'pending_review' },
      input: request(),
      kind: 'policy_denied',
    },
    {
      name: 'credential scope is not allowlisted',
      policy: activePolicy,
      input: request({ credentialScope: 'places.write' }),
      kind: 'policy_denied',
    },
    {
      name: 'HTTP is not allowed',
      policy: activePolicy,
      input: request({ url: 'http://api.example.test/search' }),
      kind: 'policy_denied',
    },
    {
      name: 'URL credentials are not allowed',
      policy: activePolicy,
      input: request({ url: 'https://owner:secret@api.example.test/search' }),
      kind: 'policy_denied',
    },
    {
      name: 'origin is not allowlisted',
      policy: activePolicy,
      input: request({ url: 'https://other.example.test/search' }),
      kind: 'policy_denied',
    },
    {
      name: 'field is not registered',
      policy: activePolicy,
      input: request({ fields: [{ name: 'debug', use: 'chat' }] }),
      kind: 'policy_denied',
    },
    {
      name: 'durable use is denied',
      policy: activePolicy,
      input: request({ fields: [{ name: 'name', use: 'durable' }] }),
      kind: 'policy_denied',
    },
    {
      name: 'prompt use is denied',
      policy: activePolicy,
      input: request({ fields: [{ name: 'placeId', use: 'prompt' }] }),
      kind: 'policy_denied',
    },
    {
      name: 'Leaflet use is denied',
      policy: activePolicy,
      input: request({ fields: [{ name: 'name', use: 'leaflet' }] }),
      kind: 'policy_denied',
    },
    {
      name: 'cross-request cache is denied',
      policy: activePolicy,
      input: request({ cache: { mode: 'cross_request', ttlSeconds: 60 } }),
      kind: 'policy_denied',
    },
    {
      name: 'required chat attribution is missing',
      policy: { ...activePolicy, attribution: {} },
      input: request(),
      kind: 'policy_denied',
    },
    {
      name: 'negative cost is invalid',
      policy: activePolicy,
      input: request({ estimatedCostUsd: -0.01 }),
      kind: 'invalid_request',
    },
    {
      name: 'empty field selection is invalid',
      policy: activePolicy,
      input: request({ fields: [] }),
      kind: 'invalid_request',
    },
    {
      name: 'duplicate field selection is invalid',
      policy: activePolicy,
      input: request({
        fields: [
          { name: 'name', use: 'request' },
          { name: 'name', use: 'chat' },
        ],
      }),
      kind: 'invalid_request',
    },
  ];
  let transports = 0;

  for (const scenario of cases) {
    const gateway = createProviderPolicyGateway({
      addressClassifier,
      policies: [scenario.policy],
      resolve: async () => ['93.184.216.34'],
      usage: { reserve: async () => 'reserved' },
      transport: async () => {
        transports += 1;
        return { status: 200, headers: {}, body: {} };
      },
    });

    const result = await gateway.invoke(scenario.input);
    assert.equal(result.ok, false, scenario.name);
    if (!result.ok) {
      assert.equal(result.error.kind, scenario.kind, scenario.name);
    }
  }

  assert.equal(transports, 0);
});

test('quota, cost, and usage-meter failures stop before provider transport with stable errors', async () => {
  const scenarios = [
    { reservation: 'quota_exceeded', expected: 'quota_exceeded' },
    { reservation: 'cost_exceeded', expected: 'cost_exceeded' },
    {
      reservation: new Error('private billing account detail'),
      expected: 'dependency_failure',
    },
  ];
  let transports = 0;

  for (const scenario of scenarios) {
    const gateway = createProviderPolicyGateway({
      addressClassifier,
      policies: [activePolicy],
      resolve: async () => ['93.184.216.34'],
      usage: {
        async reserve() {
          if (scenario.reservation instanceof Error) {
            throw scenario.reservation;
          }
          return scenario.reservation;
        },
      },
      transport: async () => {
        transports += 1;
        return { status: 200, headers: {}, body: {} };
      },
    });

    const result = await gateway.invoke(request());
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.kind, scenario.expected);
      assert.doesNotMatch(result.error.message, /billing|account|private/u);
    }
  }

  assert.equal(transports, 0);
});

test('POST redirects preserve structured bodies only for 307/308 and reject unsafe method rewrites', async () => {
  const body = {
    origin: { latitude: 35.6812, longitude: 139.7671 },
    destination: { latitude: 35.6895, longitude: 139.6917 },
    travelMode: 'WALK',
  };
  const calls = [];
  const preservingGateway = createProviderPolicyGateway({
    addressClassifier,
    policies: [activePolicy],
    resolve: async () => ['93.184.216.34'],
    usage: { reserve: async () => 'reserved' },
    transport: async (providerRequest) => {
      calls.push(providerRequest);
      return calls.length === 1
        ? {
            status: 307,
            headers: { location: 'https://api.example.test/routes-v2' },
            body: {},
          }
        : {
            status: 200,
            headers: {},
            body: { placeId: 'route-1', name: 'Walking route' },
          };
    },
  });

  const preserved = await preservingGateway.invoke(
    request({ method: 'POST', body }),
  );
  assert.equal(preserved.ok, true);
  assert.deepEqual(
    calls.map(({ method, body: sentBody }) => ({ method, body: sentBody })),
    [
      { method: 'POST', body },
      { method: 'POST', body },
    ],
  );

  let rewriteCalls = 0;
  const rewritingGateway = createProviderPolicyGateway({
    addressClassifier,
    policies: [activePolicy],
    resolve: async () => ['93.184.216.34'],
    usage: { reserve: async () => 'reserved' },
    transport: async () => {
      rewriteCalls += 1;
      return {
        status: 302,
        headers: { location: 'https://api.example.test/routes-v2' },
        body: {},
      };
    },
  });
  const rewritten = await rewritingGateway.invoke(
    request({ method: 'POST', body }),
  );
  assert.equal(rewritten.ok, false);
  if (!rewritten.ok) assert.equal(rewritten.error.kind, 'policy_denied');
  assert.equal(rewriteCalls, 1);
});

test('method and structured-body validation rejects ambiguous or credential-bearing requests', async () => {
  const invalidRequests = [
    request({ method: 'GET', body: { origin: 'Tokyo' } }),
    request({ method: 'POST' }),
    request({ method: 'POST', body: { apiKey: 'must-not-pass' } }),
    request({ method: 'DELETE' }),
  ];
  let transports = 0;
  const gateway = createProviderPolicyGateway({
    addressClassifier,
    policies: [activePolicy],
    resolve: async () => ['93.184.216.34'],
    usage: { reserve: async () => 'reserved' },
    transport: async () => {
      transports += 1;
      return { status: 200, headers: {}, body: {} };
    },
  });

  for (const input of invalidRequests) {
    const result = await gateway.invoke(input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.kind, 'invalid_request');
  }
  assert.equal(transports, 0);
});
