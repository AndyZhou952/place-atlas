import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  browserOperationHttpCatalog,
  createAgentCapabilitiesDocument,
} from './atlas-browser-operation-catalog.ts';

test('agent capabilities preserve their HTTP surface and are generated from the Browser mapping', () => {
  const {
    intakeAuthentication,
    externalAgentIntakeAuthentication,
    ...document
  } = createAgentCapabilitiesDocument();
  assert.equal(intakeAuthentication.type, 'owner_session_cookie');
  assert.equal(intakeAuthentication.sameOriginRequired, true);
  assert.equal(
    intakeAuthentication.conversationHeader,
    'x-atlas-web-conversation-id',
  );
  assert.deepEqual(externalAgentIntakeAuthentication, {
    type: 'bearer_token',
    endpoint: '/api/agent/catalog-intake',
    scope: 'catalog_intake_only',
    conversationHeader: 'x-atlas-agent-conversation-id',
    instruction:
      'Send {operation,input} with the dedicated Add Agent token. Echo the conversation header from discover on select, confirm and cancel. Confirm only after reviewing the current preview and version.',
  });
  assert.deepEqual(
    {
      ...document,
      operations: document.operations.filter(
        ({ path }) => !path.startsWith('/api/catalog-intake/'),
      ),
    },
    {
      service: 'Japan Atlas',
      version: '0.7',
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
        {
          name: 'delete_atlas_item',
          method: 'DELETE',
          path: '/api/items/{id}',
        },
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
    },
  );

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
    const { capability, ...descriptor } =
      browserOperationHttpCatalog[`catalog.intake.${operation}`];
    assert.ok(capability);
    assert.deepEqual(descriptor, {
      key: `catalog.intake.${operation}`,
      method: 'POST',
      path: `/api/catalog-intake/${operation}`,
      bodyKind: 'json',
    });
  }
  const intake = document.operations.filter(({ path }) =>
    path.startsWith('/api/catalog-intake/'),
  );
  assert.deepEqual(
    intake.map(({ name }) => name),
    [
      'discover_restaurant',
      'preview_restaurant',
      'confirm_restaurant',
      'cancel_restaurant',
    ],
  );
  assert.deepEqual(intake[0].contract.required, ['query', 'requestToken']);
  assert.deepEqual(intake[1].contract.required, [
    'sessionId',
    'expectedSessionVersion',
    'ordinal',
  ]);
  assert.deepEqual(intake[2].contract.required, [
    'sessionId',
    'expectedPreviewVersion',
  ]);
  assert.equal(intake[2].contract.requiresExplicitOwnerConfirmation, true);
  assert.equal(intake[2].contract.mapVisibleStatus, 'committed_verified');
  assert.deepEqual(intake[3].contract.required, [
    'sessionId',
    'expectedSessionVersion',
  ]);
  assert.equal(
    Object.keys(browserOperationHttpCatalog).some((key) =>
      key.startsWith('import.'),
    ),
    false,
  );
  assert.equal(
    createAgentCapabilitiesDocument().operations.some(
      ({ name, path }) =>
        name === 'queue_creator_import' || path.startsWith('/api/inbox'),
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
