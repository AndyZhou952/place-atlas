import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createAtlasViewModelState,
  reduceAtlasViewModelState,
} from './atlas-view-model-state.ts';

const item = {
  id: 'place-1',
  title: '店',
  personalRating: undefined,
  isFavorite: false,
  hasVisited: false,
};

test('optimistic item mutations converge on success and roll back independently on failure', () => {
  let state = createAtlasViewModelState({ items: [item] });

  state = reduceAtlasViewModelState(state, {
    type: 'item.mutation.started',
    itemId: item.id,
    mutationId: 'favorite',
    patch: { isFavorite: true },
  });
  state = reduceAtlasViewModelState(state, {
    type: 'item.mutation.started',
    itemId: item.id,
    mutationId: 'rating',
    patch: { personalRating: 4.26 },
  });
  assert.equal(state.items[0].isFavorite, true);
  assert.equal(state.items[0].personalRating, 4.26);

  state = reduceAtlasViewModelState(state, {
    type: 'item.mutation.failed',
    itemId: item.id,
    mutationId: 'favorite',
  });
  assert.equal(state.items[0].isFavorite, false);
  assert.equal(state.items[0].personalRating, 4.26);

  state = reduceAtlasViewModelState(state, {
    type: 'item.mutation.succeeded',
    itemId: item.id,
    mutationId: 'rating',
    item: { ...item, personalRating: 4.3 },
  });
  assert.deepEqual(state.items, [{ ...item, personalRating: 4.3 }]);
});

test('a late initial read does not erase an in-flight optimistic mutation', () => {
  let state = createAtlasViewModelState({ items: [item] });
  state = reduceAtlasViewModelState(state, {
    type: 'items.load.started',
    loadId: 'initial-items',
  });
  state = reduceAtlasViewModelState(state, {
    type: 'item.mutation.started',
    itemId: item.id,
    mutationId: 'favorite',
    patch: { isFavorite: true },
  });

  state = reduceAtlasViewModelState(state, {
    type: 'items.loaded',
    loadId: 'initial-items',
    items: [{ ...item, title: 'Server title' }],
  });

  assert.equal(state.items[0].title, item.title);
  assert.equal(state.items[0].isFavorite, true);
});

test('optimistic Visit removal rolls back its Visit and media without inventing item state', () => {
  const visit = {
    id: 'visit-1',
    itemId: item.id,
    itemTitle: item.title,
    visitedAt: '2026-09-12',
    createdAt: '2026-09-12T00:00:00.000Z',
    updatedAt: '2026-09-12T00:00:00.000Z',
  };
  const media = { id: 'media-1', visitId: visit.id, itemId: item.id };
  let state = createAtlasViewModelState({
    items: [{ ...item, hasVisited: true }],
    visits: [visit],
    media: [media],
  });

  state = reduceAtlasViewModelState(state, {
    type: 'visit.removed',
    visitId: visit.id,
  });
  assert.deepEqual(state.visits, []);
  assert.deepEqual(state.media, []);
  assert.equal(state.items[0].hasVisited, true);

  state = reduceAtlasViewModelState(state, {
    type: 'visit.restored',
    visit,
    media: [media],
  });
  assert.deepEqual(state.visits, [visit]);
  assert.deepEqual(state.media, [media]);
  assert.equal(state.items[0].hasVisited, true);
});

test('an item mutation success rejects an older read but a newer refresh still converges', () => {
  let state = createAtlasViewModelState({ items: [item] });
  state = reduceAtlasViewModelState(state, {
    type: 'items.load.started',
    loadId: 'old-items',
  });
  state = reduceAtlasViewModelState(state, {
    type: 'item.mutation.started',
    itemId: item.id,
    mutationId: 'favorite',
    patch: { isFavorite: true },
  });
  state = reduceAtlasViewModelState(state, {
    type: 'item.mutation.succeeded',
    itemId: item.id,
    mutationId: 'favorite',
    item: { ...item, isFavorite: true },
  });
  state = reduceAtlasViewModelState(state, {
    type: 'items.loaded',
    loadId: 'old-items',
    items: [item],
  });
  assert.equal(state.items[0].isFavorite, true);

  state = reduceAtlasViewModelState(state, {
    type: 'items.load.started',
    loadId: 'fresh-items',
  });
  state = reduceAtlasViewModelState(state, {
    type: 'items.loaded',
    loadId: 'fresh-items',
    items: [{ ...item, title: 'Fresh server title' }],
  });
  assert.equal(state.items[0].title, 'Fresh server title');
});

test('Visit create and delete successes reject reads started before their mutations', () => {
  const visit = {
    id: 'visit-1',
    itemId: item.id,
    itemTitle: item.title,
    visitedAt: '2026-09-12',
    createdAt: '2026-09-12T00:00:00.000Z',
    updatedAt: '2026-09-12T00:00:00.000Z',
  };
  let state = createAtlasViewModelState();
  state = reduceAtlasViewModelState(state, {
    type: 'visits.load.started',
    loadId: 'before-create',
  });
  state = reduceAtlasViewModelState(state, {
    type: 'visit.prepended',
    visit,
  });
  state = reduceAtlasViewModelState(state, {
    type: 'visit.received',
    optimisticId: visit.id,
    visit,
  });
  state = reduceAtlasViewModelState(state, {
    type: 'visits.loaded',
    loadId: 'before-create',
    visits: [],
  });
  assert.deepEqual(state.visits, [visit]);

  state = reduceAtlasViewModelState(state, {
    type: 'visits.load.started',
    loadId: 'before-delete',
  });
  state = reduceAtlasViewModelState(state, {
    type: 'visit.removed',
    visitId: visit.id,
  });
  state = reduceAtlasViewModelState(state, {
    type: 'visits.loaded',
    loadId: 'before-delete',
    visits: [visit],
  });
  assert.deepEqual(state.visits, []);
});

test('a completed media batch rejects an older media read', () => {
  const stored = { id: 'media-new', visitId: 'visit-1', itemId: item.id };
  let state = createAtlasViewModelState();
  state = reduceAtlasViewModelState(state, {
    type: 'media.load.started',
    loadId: 'old-media',
  });
  state = reduceAtlasViewModelState(state, {
    type: 'media.appended',
    media: [stored],
  });
  state = reduceAtlasViewModelState(state, {
    type: 'media.loaded',
    loadId: 'old-media',
    media: [],
  });
  assert.deepEqual(state.media, [stored]);
});

test('a queued import rejects an older ImportJob read', () => {
  const stored = { id: 'import-new', status: 'queued' };
  let state = createAtlasViewModelState();
  state = reduceAtlasViewModelState(state, {
    type: 'import-jobs.load.started',
    loadId: 'old-imports',
  });
  state = reduceAtlasViewModelState(state, {
    type: 'import-job.prepended',
    importJob: stored,
  });
  state = reduceAtlasViewModelState(state, {
    type: 'import-jobs.loaded',
    loadId: 'old-imports',
    importJobs: [],
  });
  assert.deepEqual(state.importJobs, [stored]);
});

test('an item deletion rejects older Visit and media reads but later refreshes still converge', () => {
  const visit = {
    id: 'visit-deleted-item',
    itemId: item.id,
    itemTitle: item.title,
    visitedAt: '2026-09-12',
    createdAt: '2026-09-12T00:00:00.000Z',
    updatedAt: '2026-09-12T00:00:00.000Z',
  };
  const media = {
    id: 'media-deleted-item',
    visitId: visit.id,
    itemId: item.id,
  };
  const importJob = { id: 'import-existing', status: 'queued' };
  let state = createAtlasViewModelState({
    items: [item],
    importJobs: [importJob],
    visits: [visit],
    media: [media],
  });
  state = reduceAtlasViewModelState(state, {
    type: 'items.load.started',
    loadId: 'before-item-delete',
  });
  state = reduceAtlasViewModelState(state, {
    type: 'visits.load.started',
    loadId: 'before-item-delete',
  });
  state = reduceAtlasViewModelState(state, {
    type: 'media.load.started',
    loadId: 'before-item-delete',
  });
  state = reduceAtlasViewModelState(state, {
    type: 'import-jobs.load.started',
    loadId: 'unrelated-import-read',
  });

  state = reduceAtlasViewModelState(state, {
    type: 'item.removed',
    itemId: item.id,
  });
  state = reduceAtlasViewModelState(state, {
    type: 'visits.loaded',
    loadId: 'before-item-delete',
    visits: [visit],
  });
  state = reduceAtlasViewModelState(state, {
    type: 'media.loaded',
    loadId: 'before-item-delete',
    media: [media],
  });
  state = reduceAtlasViewModelState(state, {
    type: 'items.loaded',
    loadId: 'before-item-delete',
    items: [item],
  });
  state = reduceAtlasViewModelState(state, {
    type: 'import-jobs.loaded',
    loadId: 'unrelated-import-read',
    importJobs: [],
  });

  assert.deepEqual(state.items, []);
  assert.deepEqual(state.visits, []);
  assert.deepEqual(state.media, []);
  assert.deepEqual(state.importJobs, []);

  state = reduceAtlasViewModelState(state, {
    type: 'visits.load.started',
    loadId: 'after-item-delete',
  });
  state = reduceAtlasViewModelState(state, {
    type: 'media.load.started',
    loadId: 'after-item-delete',
  });
  state = reduceAtlasViewModelState(state, {
    type: 'visits.loaded',
    loadId: 'after-item-delete',
    visits: [visit],
  });
  state = reduceAtlasViewModelState(state, {
    type: 'media.loaded',
    loadId: 'after-item-delete',
    media: [media],
  });

  assert.deepEqual(state.visits, [visit]);
  assert.deepEqual(state.media, [media]);
});

test('the ViewModel state module has no transport, server, or WebMCP dependency', async () => {
  const source = await readFile(
    new URL('./atlas-view-model-state.ts', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(source, /atlas-api-client|\/api\/|server|WebMcp/);
  assert.doesNotMatch(source, /hasAnotherVisit|manualVisited|visitCount/);
});
