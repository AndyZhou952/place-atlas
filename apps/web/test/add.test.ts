// The Add harness wired through the Worker: Google Places verifies the typed place, Nominatim
// confirms coordinates, and confirmation publishes one verified restaurant.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Env } from '../src/server/env.ts';
import { handleApi } from '../src/server/worker.ts';
import { migratedD1, stubFetch } from './fixtures.ts';

const ORIGIN = 'https://atlas.test';
const PLACE_ID = 'ChIJsyntheticPlace001';

function setup(
  overrides: Partial<Env> = {},
  routes: Record<string, (request: Request) => Response> = {},
) {
  const { db, sqlite } = migratedD1();
  const env: Env = {
    DB: db,
    MEDIA: {} as R2Bucket,
    ATLAS_OWNER_PASSWORD: 'owner-pass',
    ATLAS_OWNER_SESSION_SECRET: 'x'.repeat(40),
    GOOGLE_PLACES_API_KEY: 'google-test-key',
    CATALOG_INTAKE_GOOGLE_PLACES_MODE: 'enabled',
    CATALOG_INTAKE_DURABLE_GEOCODER_MODE: 'enabled',
    ...overrides,
  };
  const place = {
    id: PLACE_ID,
    displayName: { text: '合成食堂 中目黒' },
    formattedAddress: '日本、〒153-0061 東京都目黒区中目黒1-2-3',
    // Google's own pin, distinct from Nominatim's, so a stored copy would show.
    location: { latitude: 35.1111, longitude: 139.2222 },
  };
  const calls: string[] = [];
  const urls: string[] = [];
  globalThis.fetch = stubFetch({
    ...routes,
    'https://places.googleapis.com/v1/places:searchText': (request) => {
      calls.push('google:search');
      urls.push(request.url);
      return Response.json({ places: [place] });
    },
    'https://places.googleapis.com/v1/places/': (request) => {
      calls.push('google:details');
      urls.push(request.url);
      return Response.json(place);
    },
    'https://nominatim.openstreetmap.org/': () => {
      calls.push('nominatim');
      return Response.json([
        {
          lat: '35.6441',
          lon: '139.6988',
          display_name: '1-2-3, 中目黒, 目黒区, 東京都, 153-0061, 日本',
          osm_type: 'node',
          osm_id: 1000001,
        },
      ]);
    },
  });
  let cookie = '';
  let conversation = '';
  const call = async (method: string, path: string, payload?: unknown) => {
    const response = await handleApi(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers: {
          origin: ORIGIN,
          'content-type': 'application/json',
          ...(cookie ? { cookie } : {}),
          ...(conversation ? { 'x-atlas-web-conversation-id': conversation } : {}),
        },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
      }),
      env,
    );
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    conversation = response.headers.get('x-atlas-web-conversation-id') ?? conversation;
    // oxlint-disable-next-line typescript/no-explicit-any -- assertions inspect the JSON
    const body: any = response.status === 204 ? null : await response.json();
    return { status: response.status, body };
  };
  /** Every stored row, to check what was never written. */
  const storedText = () =>
    JSON.stringify(
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map(({ name }) => sqlite.prepare(`SELECT * FROM "${String(name)}"`).all()),
    );
  return { env, call, calls, urls, storedText };
}

test('Owner Add: Google-verified discover → select → confirm publishes a verified restaurant', async () => {
  const { call, calls, urls, storedText } = setup();
  assert.equal((await call('POST', '/api/session', { password: 'owner-pass' })).status, 200);

  const discovered = await call('POST', '/api/catalog-intake/discover', {
    input: { query: '合成食堂 中目黒', requestToken: 'request-0001' },
  });
  assert.equal(discovered.status, 200, JSON.stringify(discovered.body));
  assert.equal(discovered.body.candidates[0].transientName, '合成食堂 中目黒');

  const selected = await call('POST', '/api/catalog-intake/select', {
    input: {
      sessionId: discovered.body.sessionId,
      expectedSessionVersion: discovered.body.sessionVersion,
      ordinal: 1,
    },
  });
  assert.equal(selected.status, 200, JSON.stringify(selected.body));
  assert.equal(selected.body.preview.candidateIdentity.placeId, PLACE_ID);

  const confirm = (previewVersion: number) =>
    call('POST', '/api/catalog-intake/confirm', {
      input: { sessionId: discovered.body.sessionId, expectedPreviewVersion: previewVersion },
    });
  let confirmed = await confirm(selected.body.preview.previewVersion);
  // Confirm re-checks the evidence; a changed preview comes back for review instead of saving.
  if (confirmed.body.status === 'conflict')
    confirmed = await confirm(confirmed.body.newPreview.previewVersion);
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.status, 'committed_verified');
  assert.deepEqual([...new Set(calls)], ['google:search', 'google:details', 'nominatim']);
  // Google's map pin only corroborates identity during the request; it is stored nowhere.
  assert.doesNotMatch(storedText(), /139\.2222/u);
  // The selected place is re-read in Japanese, like its Tabelog listing; search is not.
  for (const url of urls)
    assert.equal(
      new URL(url).searchParams.get('languageCode'),
      url.includes(':searchText') ? null : 'ja',
    );

  const saved = (await call('GET', '/api/restaurants')).body.find(
    (restaurant: { title: string }) => restaurant.title === '合成食堂 中目黒',
  );
  assert.equal(saved.googlePlaceId, PLACE_ID);
  assert.equal(saved.prefecture, 'JP-13');
});

test('a pasted Tabelog URL is read once per Add request, not again for research', async () => {
  const listing = 'https://tabelog.com/tokyo/A1317/A131701/13999901/';
  const restaurant = {
    '@type': 'Restaurant',
    '@id': listing,
    name: '合成食堂',
    address: {
      addressRegion: '東京都',
      addressLocality: '目黒区',
      streetAddress: '中目黒1-2-3',
      postalCode: '1530061',
    },
    geo: { latitude: 35.6441, longitude: 139.6988 },
    aggregateRating: { '@type': 'AggregateRating', ratingValue: '3.51' },
  };
  let reads = 0;
  const { call } = setup(
    {
      CATALOG_INTAKE_GOOGLE_PLACES_MODE: undefined,
      AGENT_API_KEY: 'test-key',
      AGENT_BASE_URL: 'https://model.test/v1',
      AGENT_MODEL: 'test-model',
    },
    {
      [listing]: () => {
        reads++;
        return new Response(
          `<script type="application/ld+json">${JSON.stringify(restaurant)}</script>`,
          { headers: { 'content-type': 'text/html' } },
        );
      },
      'https://model.test/v1/chat/completions': () =>
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  subjectMatch: 'matched',
                  tabelog: { status: 'unknown' },
                  reservation: { status: 'unknown' },
                }),
              },
            },
          ],
        }),
    },
  );
  await call('POST', '/api/session', { password: 'owner-pass' });
  const discovered = await call('POST', '/api/catalog-intake/discover', {
    input: { query: listing, requestToken: 'request-0003' },
  });
  assert.equal(discovered.status, 200, JSON.stringify(discovered.body));
  assert.equal(discovered.body.candidates[0].transientName, '合成食堂');
  assert.equal(reads, 1);
  const selected = await call('POST', '/api/catalog-intake/select', {
    input: {
      sessionId: discovered.body.sessionId,
      expectedSessionVersion: discovered.body.sessionVersion,
      ordinal: 1,
    },
  });
  assert.equal(selected.status, 200, JSON.stringify(selected.body));
  assert.equal(selected.body.preview.tabelog.score, 3.51);
  assert.equal(reads, 2, 'the identity refetch and research share one read');
  const confirmed = await call('POST', '/api/catalog-intake/confirm', {
    input: {
      sessionId: discovered.body.sessionId,
      expectedPreviewVersion: selected.body.preview.previewVersion,
    },
  });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.status, 'committed_verified', JSON.stringify(confirmed.body));
  assert.equal(reads, 3, 'the confirm refetch and re-research share one read');
});

test('Add steps after discover must echo the conversation, and need the Owner session', async () => {
  const { call } = setup();
  const anonymous = await call('POST', '/api/catalog-intake/discover', {
    input: { query: '合成食堂', requestToken: 'request-0002' },
  });
  assert.equal(anonymous.status, 401);
  await call('POST', '/api/session', { password: 'owner-pass' });
  const forged = await call('POST', '/api/catalog-intake/cancel', {
    input: { sessionId: 'session-unknown', expectedSessionVersion: 1 },
  });
  assert.equal(forged.status, 400);
});

test('the external Add Agent uses its Bearer token and cannot assert Owner fields', async () => {
  const { env } = setup();
  const token = 'a'.repeat(40);
  const agentEnv = { ...env, ATLAS_ADD_AGENT_TOKEN: token };
  const send = (authorization: string, body: unknown) =>
    handleApi(
      new Request(`${ORIGIN}/api/agent/catalog-intake`, {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      agentEnv,
    );
  // The wire names are the 0.1 ones; the harness's short names are not part of the API.
  const discover = {
    operation: 'catalog.intake.discover',
    input: { query: '合成食堂', requestToken: 'agent-0001' },
  };
  assert.equal((await send(`Bearer ${'b'.repeat(40)}`, discover)).status, 401);
  assert.equal((await send(`Bearer ${token}`, { ...discover, operation: 'discover' })).status, 400);
  const accepted = await send(`Bearer ${token}`, discover);
  assert.equal(accepted.status, 200);
  assert.match(accepted.headers.get('x-atlas-agent-conversation-id') ?? '', /^[a-f0-9]{32}$/u);
  const ownerFields = await send(`Bearer ${token}`, {
    operation: 'catalog.intake.select',
    input: { sessionId: 's', expectedSessionVersion: 1, ordinal: 1, ownerFields: {} },
  });
  assert.equal(ownerFields.status, 400);
});
