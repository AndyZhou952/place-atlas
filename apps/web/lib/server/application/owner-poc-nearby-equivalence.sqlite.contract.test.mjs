import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { createOwnerPocAgentHttpHandler } from '../../../adapters/agent/isolated-readonly-agent-service.ts';
import { nearbyAtlasItemsResponse } from '../../../app/api/nearby/nearby-atlas-items-response.ts';
import { createAtlasApplication } from '../../../product/application/atlas-application.ts';
import { signAgentHttpRequest } from '../../../product/application/conversation/agent-request-signing.ts';
import {
  createCatalogIntakeOperationGroup,
  createUnavailableCatalogIntakeModule,
} from '../../../product/application/catalog-intake/catalog-intake-coordinator.ts';
import { createNearbyRecommendationOperationGroup } from '../../../product/application/decision/agent-nearby-operation.ts';
import { createOwnerPocComposition } from './owner-poc-composition.ts';
import { D1CatalogIntakeState } from './d1-catalog-intake-state.ts';

const migrationRoot = new URL(
  '../../../../../features/004-openclaw-atlas-poc/deployment/cloudflare-owner-poc/',
  import.meta.url,
);
const requestOnly = {
  hint: 'REQUEST-ONLY-GINZA',
  address: 'REQUEST-ONLY-CANONICAL-ADDRESS',
  raw: 'SIDE-CAR-RAW-JSON-POISON',
  coordinates: 'SIDE-CAR-COORDINATE-POISON',
  route: 'SIDE-CAR-ROUTE-PAYLOAD-POISON',
};

void test('canonical Browser HTTP and signed Agent HMAC return equivalent nearby facts without persisting Sidecar request data', async () => {
  const sqlite = new DatabaseSync(':memory:');
  for (const migration of [
    '0001_owner_poc_schema.sql',
    '0002_owner_poc_catalog_seed.sql',
    '0003_copy_legacy_catalog.sql',
    '0004_provider_usage_skus.sql',
  ]) {
    sqlite.exec(await readFile(new URL(migration, migrationRoot), 'utf8'));
  }
  sqlite
    .prepare(
      `INSERT INTO place_assessments (
         item_id, overall_rating, is_favorite, has_visited, summary,
         created_at, updated_at
       ) VALUES ('koffee-mameya-kakeru', 4.75, 1, 1, 'owner fact', ?, ?)`,
    )
    .run('2026-09-21T00:00:00.000Z', '2026-09-21T00:00:00.000Z');
  sqlite
    .prepare(
      `INSERT INTO visits (
         id, item_id, item_title, visited_at, note, created_at, updated_at
       ) VALUES ('visit-owner', 'koffee-mameya-kakeru', 'KOFFEE MAMEYA Kakeru',
                 '2026-09-20T12:00:00.000Z', NULL, ?, ?)`,
    )
    .run('2026-09-20T12:00:00.000Z', '2026-09-20T12:00:00.000Z');

  const database = toD1(sqlite);
  const serviceCalls = [];
  const checkedAt = new Date().toISOString();
  const routeSidecar = {
    async geocode(request) {
      serviceCalls.push(['geocode', request]);
      return {
        ok: true,
        evidence: {
          candidates: [
            {
              formattedAddress: requestOnly.address,
              point: {
                latitude: 35.671234567,
                longitude: 139.765234567,
                rawCoordinateToken: requestOnly.coordinates,
              },
              rawGoogleBody: requestOnly.raw,
            },
          ],
          attribution: {
            label: 'Google Maps',
            url: 'https://www.google.com/maps',
          },
          source: {
            providerId: 'google-maps-platform',
            endpoint: 'https://maps.googleapis.com/maps/api/geocode/json',
          },
          checkedAt,
          rawGoogleBody: requestOnly.raw,
        },
      };
    },
    async walkingMatrix(request) {
      serviceCalls.push(['walkingMatrix', request]);
      return {
        ok: true,
        evidence: {
          routes: [
            {
              destinationIndex: 0,
              durationSeconds: 480,
              distanceMeters: 640,
              rawRouteToken: requestOnly.route,
            },
          ],
          attribution: {
            label: 'Google Maps',
            url: 'https://www.google.com/maps',
          },
          source: {
            providerId: 'google-maps-platform',
            endpoint:
              'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
          },
          checkedAt,
          rawGoogleBody: requestOnly.raw,
        },
      };
    },
  };
  const composition = createOwnerPocComposition(database, routeSidecar);
  const application = createAtlasApplication({
    ...createNearbyRecommendationOperationGroup({
      ...composition.agentNearby,
      catalog: composition.catalogRead,
    }),
    ...createCatalogIntakeOperationGroup(
      createUnavailableCatalogIntakeModule(),
    ),
  });
  const mediaCalls = [];
  const media = {
    async get() {
      mediaCalls.push('get');
      return null;
    },
    async put() {
      mediaCalls.push('put');
    },
    async delete() {
      mediaCalls.push('delete');
    },
  };
  const nowMs = Date.parse('2026-09-21T00:02:00.000Z');
  const secret = 'fixture-hmac-secret-never-persist';
  const bindings = {
    DB: database,
    MEDIA: media,
    ATLAS_DATASET: 'owner-poc',
    ATLAS_DEPLOYMENT_ENV: 'owner-poc',
    AGENT_JPMAP_KEY_ID: 'fixture-key',
    AGENT_JPMAP_HMAC_SECRET: secret,
    AGENT_OWNER_ACTOR_ID: 'owner-wechat',
    AGENT_OWNER_CONVERSATION_ID: 'owner-dm',
    ROUTE_SIDECAR: routeSidecar,
  };
  const handleAgent = createOwnerPocAgentHttpHandler(
    bindings,
    application,
    new D1CatalogIntakeState(database),
    { nowMs: () => nowMs },
  );
  const logLines = [];
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  console.log = (...values) => logLines.push(values);
  console.warn = (...values) => logLines.push(values);
  console.error = (...values) => logLines.push(values);

  let browserResponse;
  let agentResponse;
  try {
    browserResponse = await nearbyAtlasItemsResponse(
      application,
      new URLSearchParams({ locationHint: requestOnly.hint }),
    );
    const agentRequest = await signAgentHttpRequest({
      url: 'https://atlas.test/api/agent/v1/tools',
      method: 'POST',
      body: {
        version: '1',
        projectId: 'jpmap',
        tool: 'jpmap_nearby',
        mutationId: 'transient-read-1',
        actor: {
          actorId: 'owner-wechat',
          channel: 'openclaw-weixin',
          conversationId: 'owner-dm',
          conversationType: 'direct',
        },
        input: { locationHint: requestOnly.hint },
      },
      keyId: 'fixture-key',
      secret,
      timestamp: String(nowMs / 1_000),
      nonce: 'transient-read-nonce-1',
    });
    agentResponse = await handleAgent(agentRequest);
  } finally {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  }

  assert.equal(browserResponse.status, 200);
  assert.equal(agentResponse.status, 200);
  const browserResult = await browserResponse.json();
  const agentPayload = await agentResponse.json();
  assert.deepEqual(agentPayload.receipt.result.nearby, browserResult);
  assert.equal(browserResult.status, 'resolved');
  assert.equal(browserResult.attribution.label, 'Google Maps');
  assert.ok(browserResult.recommendations.length > 0);
  assert.ok(
    browserResult.recommendations.every(
      (candidate) => candidate.route?.source.label === 'Google Maps',
    ),
  );
  const personal = browserResult.recommendations.find(
    ({ itemId }) => itemId === 'koffee-mameya-kakeru',
  );
  assert.deepEqual(personal.visit, {
    manualVisited: true,
    visitCount: 1,
    latestVisitAt: '2026-09-20T12:00:00.000Z',
    personalRating: 4.75,
  });
  assert.equal(
    personal.entryAccess.walkInAssertion.warning,
    'Walk-in status is unavailable.',
  );
  assert.equal(
    personal.entryAccess.queueAssertion.warning,
    'Queue status is unavailable.',
  );

  assert.equal(
    sqlite.prepare('SELECT COUNT(*) AS count FROM agent_gateway_receipts').get()
      .count,
    0,
  );
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) AS count FROM agent_gateway_nonces').get()
      .count,
    1,
  );
  assert.equal(
    sqlite.prepare('SELECT COUNT(*) AS count FROM agent_gateway_audit').get()
      .count,
    1,
  );
  const persisted = JSON.stringify(dumpDatabase(sqlite));
  for (const sentinel of Object.values(requestOnly)) {
    assert.doesNotMatch(persisted, new RegExp(sentinel, 'u'));
  }
  assert.deepEqual(mediaCalls, []);
  assert.deepEqual(logLines, []);
  assert.ok(serviceCalls.length > 2);
  assert.doesNotMatch(
    JSON.stringify(browserResult),
    /SIDE-CAR-RAW|SIDE-CAR-COORDINATE|SIDE-CAR-ROUTE|latitude|longitude/u,
  );
});

void test('Route Sidecar request evidence has no prompt/model or Leaflet dependency path', async () => {
  const [adapter, composition, operation, atlasMap, leafletAdapter] =
    await Promise.all([
      readFile(
        new URL(
          '../../../route-sidecar/route-sidecar-nearby-adapter.ts',
          import.meta.url,
        ),
        'utf8',
      ),
      readFile(new URL('./owner-poc-composition.ts', import.meta.url), 'utf8'),
      readFile(
        new URL(
          '../../../product/application/decision/agent-nearby-operation.ts',
          import.meta.url,
        ),
        'utf8',
      ),
      readFile(
        new URL('../../../features/atlas/atlas-map.tsx', import.meta.url),
        'utf8',
      ),
      readFile(
        new URL(
          '../../../features/atlas/leaflet-map-adapter.ts',
          import.meta.url,
        ),
        'utf8',
      ),
    ]);

  const privateFlow = `${adapter}\n${composition}\n${operation}`;
  assert.doesNotMatch(
    privateFlow,
    /DeepSeek|ModelContext|provider-policy|\bprompt\b|console\.(?:log|warn|error)/u,
  );
  const leafletFlow = `${atlasMap}\n${leafletAdapter}`;
  assert.doesNotMatch(
    leafletFlow,
    /route-sidecar|ROUTE_SIDECAR|resolvedLocation|provenance|durationMinutes|checkedAt/u,
  );
});

function toD1(database) {
  return {
    prepare(sql) {
      const statement = database.prepare(sql);
      const bound = (values) => ({
        bind(...nextValues) {
          return bound(nextValues);
        },
        async all() {
          return { results: statement.all(...values) };
        },
        async first() {
          return statement.get(...values) ?? null;
        },
        async run() {
          const result = statement.run(...values);
          return { meta: { changes: Number(result.changes) } };
        },
      });
      return bound([]);
    },
  };
}

function dumpDatabase(database) {
  const tables = database
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all();
  return Object.fromEntries(
    tables.map(({ name }) => [
      name,
      database.prepare(`SELECT * FROM "${name}"`).all(),
    ]),
  );
}
