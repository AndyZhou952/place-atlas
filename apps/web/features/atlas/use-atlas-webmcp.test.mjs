import assert from 'node:assert/strict';
import test from 'node:test';

import { createAtlasWebMcpTools } from './use-atlas-webmcp.ts';

const item = {
  id: 'place-1',
  title: '店',
  kind: 'food',
  area: 'Tokyo',
  verificationStatus: 'verified',
  tabelog: { score: 4.1 },
};

function createTools(overrides = {}) {
  const calls = [];
  const selected = [];
  const application = {
    async execute(operation) {
      calls.push(operation);
      switch (operation.key) {
        case 'catalog.list':
          return [
            item,
            {
              ...item,
              id: 'review-1',
              title: 'Review',
              verificationStatus: 'needs_review',
            },
          ];
        case 'assessment.update':
          return {
            ...item,
            isFavorite: operation.input.patch.isFavorite ?? false,
            hasVisited: operation.input.patch.manualVisited ?? false,
            personalRating: operation.input.patch.overallRating ?? undefined,
          };
        case 'catalog.update_item':
          return { ...item, ...operation.input };
        case 'catalog.delete_item':
          return { id: operation.input.id, deleted: true };
        case 'import.queue':
          return { id: 'job-1', ...operation.input, status: 'queued' };
        case 'visit.create':
          return { visit: { id: 'visit-1' }, item };
        case 'visit.update':
          return { visit: { id: operation.input.id }, item };
        case 'visit.delete':
          return { item };
        case 'media.list':
          return [
            {
              id: 'media-1',
              visitId: operation.input.visitId,
              contentSha256: 'private-hash',
              contentUrl: '/api/media/media-1/content',
            },
          ];
        case 'media.caption':
          return { id: operation.input.id, caption: operation.input.caption };
        case 'media.delete':
          return { deleted: true };
        case 'decision.nearby':
          return [
            { id: 'review-1', title: 'Review', distanceKm: 0.2 },
            { id: item.id, title: item.title, distanceKm: 0.3 },
          ];
        default:
          throw new Error(`Unexpected operation: ${operation.key}`);
      }
    },
  };
  const tools = createAtlasWebMcpTools({
    application,
    items: [item],
    selectItem: (id) => selected.push(id),
    getCurrentCoordinates: async () => ({ latitude: 35.68, longitude: 139.76 }),
    ...overrides,
  });
  return { application, calls, selected, tools };
}

test('WebMCP keeps the existing tool names, input schemas, and annotations', () => {
  const { tools } = createTools();

  assert.deepEqual(
    tools.map(({ name, inputSchema, annotations }) => ({
      name,
      inputSchema,
      annotations,
    })),
    [
      contract('list_atlas_items', {}),
      contract(
        'focus_atlas_item',
        {
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        { readOnlyHint: true, untrustedContentHint: false },
      ),
      contract(
        'update_atlas_item',
        {
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
            personalState: {
              type: 'string',
              enum: ['candidate', 'saved', 'planned', 'visited'],
            },
          },
          required: ['id', 'title', 'description', 'personalState'],
        },
        writeAnnotations,
      ),
      contract(
        'queue_creator_import',
        {
          properties: {
            creatorName: { type: 'string' },
            sourceRef: { type: 'string' },
            platform: { type: 'string' },
          },
          required: ['creatorName', 'sourceRef'],
        },
        writeAnnotations,
      ),
      contract(
        'update_item_preferences',
        {
          properties: {
            id: { type: 'string' },
            isFavorite: { type: 'boolean' },
            hasVisited: { type: 'boolean' },
          },
          required: ['id'],
        },
        writeAnnotations,
      ),
      contract(
        'set_personal_rating',
        {
          properties: {
            id: { type: 'string' },
            rating: { type: ['number', 'null'], minimum: 0, maximum: 5 },
          },
          required: ['id', 'rating'],
        },
        writeAnnotations,
      ),
      contract(
        'create_visit',
        {
          properties: {
            mutationId: { type: 'string' },
            itemId: { type: 'string' },
            visitedAt: { type: 'string' },
            rating: { type: 'number', minimum: 0, maximum: 5 },
            note: { type: 'string' },
          },
          required: ['itemId', 'visitedAt'],
        },
        writeAnnotations,
      ),
      contract(
        'update_visit',
        {
          properties: {
            id: { type: 'string' },
            visitedAt: { type: 'string' },
            rating: { type: ['number', 'null'], minimum: 0, maximum: 5 },
            note: { type: 'string' },
          },
          required: ['id', 'visitedAt'],
        },
        writeAnnotations,
      ),
      contract('list_visit_media', {
        properties: { visitId: { type: 'string' } },
        required: ['visitId'],
      }),
      contract(
        'update_visit_media_caption',
        {
          properties: {
            id: { type: 'string' },
            caption: { type: 'string', maxLength: 160 },
          },
          required: ['id', 'caption'],
        },
        writeAnnotations,
      ),
      contract(
        'delete_visit_media',
        {
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        destructiveAnnotations,
      ),
      contract(
        'delete_visit',
        {
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        destructiveAnnotations,
      ),
      contract(
        'delete_atlas_item',
        {
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
        destructiveAnnotations,
      ),
      contract(
        'find_nearby_atlas_items',
        {},
        {
          readOnlyHint: true,
          untrustedContentHint: false,
        },
      ),
    ],
  );
});

test('persistent WebMCP tools execute Browser AtlasApplication operations instead of cached actions', async () => {
  const { calls, tools } = createTools();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  const listed = await byName.get('list_atlas_items').execute({});
  await byName.get('update_atlas_item').execute({
    id: item.id,
    title: 'New',
    description: 'Description',
    personalState: 'saved',
  });
  await byName.get('queue_creator_import').execute({
    creatorName: 'Creator',
    sourceRef: 'https://example.test',
  });
  await byName.get('update_item_preferences').execute({
    id: item.id,
    isFavorite: true,
    hasVisited: false,
  });
  await byName
    .get('set_personal_rating')
    .execute({ id: item.id, rating: 4.26 });
  await byName.get('create_visit').execute({
    mutationId: 'mutation-1',
    itemId: item.id,
    visitedAt: '2026-09-12',
    rating: 4.26,
  });
  await byName.get('update_visit').execute({
    id: 'visit-1',
    visitedAt: '2026-09-13',
    rating: null,
  });
  const media = await byName
    .get('list_visit_media')
    .execute({ visitId: 'visit-1' });
  await byName.get('update_visit_media_caption').execute({
    id: 'media-1',
    caption: 'Dish',
  });
  await byName.get('delete_visit_media').execute({ id: 'media-1' });
  await byName.get('delete_visit').execute({ id: 'visit-1' });
  await byName.get('delete_atlas_item').execute({ id: item.id });

  assert.deepEqual(
    listed.map((candidate) => candidate.verificationStatus),
    ['verified', 'needs_review'],
  );
  assert.equal(media[0].contentSha256, undefined);
  assert.deepEqual(
    calls.map((call) => call.key),
    [
      'catalog.list',
      'catalog.update_item',
      'import.queue',
      'assessment.update',
      'assessment.update',
      'visit.create',
      'visit.update',
      'media.list',
      'media.caption',
      'media.delete',
      'visit.delete',
      'catalog.delete_item',
    ],
  );
  assert.deepEqual(calls[0].input, { profile: 'full_merged_catalog' });
  assert.deepEqual(calls[3].input.patch, {
    isFavorite: true,
    manualVisited: false,
  });
  assert.deepEqual(calls[4].input.patch, { overallRating: 4.3 });
});

test('nearby uses the full merged Application profile while focus stays UI-only', async () => {
  const { calls, selected, tools } = createTools();
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  const focused = await byName.get('focus_atlas_item').execute({ id: item.id });
  assert.deepEqual(focused, { id: item.id, title: item.title, focused: true });
  assert.deepEqual(calls, []);

  const nearby = await byName.get('find_nearby_atlas_items').execute({});
  assert.deepEqual(calls, [
    {
      key: 'decision.nearby',
      input: {
        latitude: 35.68,
        longitude: 139.76,
        limit: 5,
        profile: 'full_merged_catalog',
      },
    },
  ]);
  assert.deepEqual(nearby, [
    { id: 'review-1', title: 'Review' },
    { id: item.id, title: item.title },
  ]);
  assert.deepEqual(selected, [item.id, 'review-1']);
});

const writeAnnotations = {
  readOnlyHint: false,
  untrustedContentHint: true,
};
const destructiveAnnotations = {
  ...writeAnnotations,
  destructiveHint: true,
};

function contract(
  name,
  { properties = {}, required } = {},
  annotations = { readOnlyHint: true, untrustedContentHint: true },
) {
  return {
    name,
    inputSchema: {
      type: 'object',
      properties,
      ...(required ? { required } : {}),
      additionalProperties: false,
    },
    annotations,
  };
}
