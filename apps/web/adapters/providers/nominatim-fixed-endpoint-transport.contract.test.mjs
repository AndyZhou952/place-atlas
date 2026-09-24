import assert from 'node:assert/strict';
import test from 'node:test';

import { createNominatimFixedEndpointTransport } from './nominatim-fixed-endpoint-transport.ts';

test('Nominatim transport accepts only the official bounded no-redirect request', async () => {
  const calls = [];
  const transport = createNominatimFixedEndpointTransport({
    fetch: async (url, init) => {
      calls.push({ url, init });
      return Response.json([]);
    },
  });
  const request = {
    url: 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&q=ginza',
    headers: {
      'User-Agent': 'JapanAtlasOwnerPoC/1.0 (+https://example.test/terms)',
      Referer: 'https://example.test/',
    },
  };
  const result = await transport.search(request);
  assert.deepEqual(result, { ok: true, value: [] });
  assert.equal(calls[0].init.redirect, 'manual');

  for (const url of [
    'https://evil.test/search?format=jsonv2&limit=3&q=ginza',
    'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=50&q=ginza',
    'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&q=ginza&email=private',
  ]) {
    assert.equal((await transport.search({ ...request, url })).ok, false);
  }
  assert.equal(calls.length, 1);
});

test('Nominatim transport rejects redirect and oversized bodies', async () => {
  const responses = [
    new Response(null, {
      status: 301,
      headers: { location: 'https://evil.test' },
    }),
    new Response('x'.repeat(70_000), {
      headers: {
        'content-length': '70000',
        'content-type': 'application/json',
      },
    }),
  ];
  const transport = createNominatimFixedEndpointTransport({
    fetch: async () => responses.shift(),
  });
  const request = {
    url: 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=3&q=ginza',
    headers: {
      'User-Agent': 'JapanAtlas/1.0 (+https://example.test)',
      Referer: 'https://example.test/',
    },
  };
  assert.equal((await transport.search(request)).ok, false);
  assert.equal((await transport.search(request)).ok, false);
});
