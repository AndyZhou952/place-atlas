import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  browserOperationHttpCatalog,
  createAgentCapabilitiesDocument,
} from './atlas-browser-operation-catalog.ts';

test('agent capabilities preserve their HTTP surface and are generated from the Browser mapping', () => {
  assert.deepEqual(createAgentCapabilitiesDocument(), {
    service: 'Japan Atlas',
    version: '0.5',
    channelStatus: 'not_connected',
    operations: [
      { name: 'list_atlas_items', method: 'GET', path: '/api/items' },
      {
        name: 'find_nearby',
        method: 'GET',
        path: '/api/nearby?lat={lat}&lon={lon}',
      },
      { name: 'update_atlas_item', method: 'PATCH', path: '/api/items/{id}' },
      {
        name: 'update_place_assessment',
        method: 'PATCH',
        path: '/api/items/{id}/personal',
      },
      { name: 'delete_atlas_item', method: 'DELETE', path: '/api/items/{id}' },
      { name: 'queue_creator_import', method: 'POST', path: '/api/inbox' },
      { name: 'create_visit', method: 'POST', path: '/api/journal' },
      {
        name: 'upload_visit_media',
        method: 'POST',
        contentType: 'multipart/form-data',
        path: '/api/media',
        contract: {
          required: ['visitId', 'files'],
          optional: ['captions'],
          maxFilesPerRequest: 4,
          perVisitLimit: null,
          retryGuidance:
            'Use bounded batches. A future intake-session adapter will supply idempotent message IDs.',
        },
      },
      {
        name: 'update_visit_media_caption',
        method: 'PATCH',
        path: '/api/media/{id}',
      },
      {
        name: 'delete_visit_media',
        method: 'DELETE',
        path: '/api/media/{id}',
      },
    ],
  });

  assert.equal(
    browserOperationHttpCatalog['media.attach'].bodyKind,
    'multipart',
  );
  assert.deepEqual(browserOperationHttpCatalog['nearby.recommend'], {
    key: 'nearby.recommend',
    method: 'GET',
    path: '/api/nearby',
    bodyKind: 'none',
  });
  for (const operation of ['discover', 'select', 'confirm', 'cancel']) {
    assert.deepEqual(
      browserOperationHttpCatalog[`catalog.intake.${operation}`],
      {
        key: `catalog.intake.${operation}`,
        method: 'POST',
        path: `/api/catalog-intake/${operation}`,
        bodyKind: 'json',
      },
    );
  }
  assert.equal(
    createAgentCapabilitiesDocument().operations.some(({ name }) =>
      name.includes('intake'),
    ),
    false,
  );
  assert.equal(
    Object.values(browserOperationHttpCatalog).filter(
      (operation) => operation.capability?.name === 'upload_visit_media',
    ).length,
    1,
  );
  assert.deepEqual(
    Object.entries(browserOperationHttpCatalog).map(([key, value]) => [
      key,
      value.key,
    ]),
    Object.keys(browserOperationHttpCatalog).map((key) => [key, key]),
  );
});

test('Browser, capabilities, and WebMCP share the mapping without a second HTTP list', async () => {
  const [browserSource, webMcpSource, capabilitiesSource] = await Promise.all([
    readFile(new URL('./atlas-api-client.ts', import.meta.url), 'utf8'),
    readFile(new URL('./use-atlas-webmcp.ts', import.meta.url), 'utf8'),
    readFile(
      new URL('../../app/api/agent/capabilities/route.ts', import.meta.url),
      'utf8',
    ),
  ]);

  assert.match(browserSource, /browserOperationHttpCatalog/);
  assert.match(webMcpSource, /browserOperationHttpCatalog/);
  assert.match(capabilitiesSource, /createAgentCapabilitiesDocument/);
  assert.doesNotMatch(webMcpSource, /['"`]\/api\//u);
  assert.doesNotMatch(capabilitiesSource, /operations\s*:\s*\[/u);
});
