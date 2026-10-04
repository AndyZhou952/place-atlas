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

test('an optimistic overall comment is visible immediately and restores the public value on failure', () => {
  const original = {
    ...item,
    overallComment: 'The original public comment.',
  };
  let state = createAtlasViewModelState({ items: [original] });

  state = reduceAtlasViewModelState(state, {
    type: 'item.mutation.started',
    itemId: item.id,
    mutationId: 'comment',
    patch: { overallComment: 'A new draft comment.' },
  });
  assert.equal(state.items[0].overallComment, 'A new draft comment.');

  state = reduceAtlasViewModelState(state, {
    type: 'item.mutation.failed',
    itemId: item.id,
    mutationId: 'comment',
  });
  assert.equal(state.items[0].overallComment, 'The original public comment.');

  state = reduceAtlasViewModelState(state, {
    type: 'item.mutation.started',
    itemId: item.id,
    mutationId: 'comment-retry',
    patch: { overallComment: 'A confirmed comment.' },
  });
  state = reduceAtlasViewModelState(state, {
    type: 'item.mutation.succeeded',
    itemId: item.id,
    mutationId: 'comment-retry',
    item: { ...original, overallComment: 'A confirmed comment.' },
  });
  assert.equal(state.items[0].overallComment, 'A confirmed comment.');
});

test('a personal mutation response cannot replace Tabelog or other catalog facts', () => {
  const catalogItem = {
    ...item,
    address: '東京都新宿区百人町1丁目24-8',
    latitude: 35.7008,
    longitude: 139.6972,
    tabelog: {
      score: 3.87,
      url: 'https://tabelog.com/tokyo/A1304/A130404/13286023/',
      checkedAt: '2026-09-24T08:00:00.000Z',
    },
    sources: [
      {
        label: 'Tabelog',
        role: 'tabelog',
        url: 'https://tabelog.com/tokyo/A1304/A130404/13286023/',
      },
    ],
  };
  let state = createAtlasViewModelState({ items: [catalogItem] });
  state = reduceAtlasViewModelState(state, {
    type: 'item.mutation.started',
    itemId: item.id,
    mutationId: 'personal-rating',
    patch: { personalRating: 3.5 },
  });

  state = reduceAtlasViewModelState(state, {
    type: 'item.mutation.succeeded',
    itemId: item.id,
    mutationId: 'personal-rating',
    item: {
      ...item,
      personalRating: 3.5,
      isFavorite: false,
      hasVisited: false,
    },
  });

  assert.equal(state.items[0].personalRating, 3.5);
  assert.deepEqual(state.items[0].tabelog, catalogItem.tabelog);
  assert.deepEqual(state.items[0].sources, catalogItem.sources);
  assert.equal(state.items[0].address, catalogItem.address);
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

test('replaying a completed media batch replaces the same IDs without duplicate thumbnails', () => {
  const first = { id: 'media-1', visitId: 'visit-1', itemId: item.id };
  const second = { id: 'media-2', visitId: 'visit-1', itemId: item.id };
  let state = createAtlasViewModelState({ items: [item] });
  state = reduceAtlasViewModelState(state, {
    type: 'media.appended',
    media: [first],
  });
  state = reduceAtlasViewModelState(state, {
    type: 'media.appended',
    media: [first, second],
  });
  assert.deepEqual(state.media, [first, second]);
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

test('a saved Visit remains editable with captioned media and removes its media with the Visit', () => {
  const optimisticVisit = {
    id: 'optimistic-visit',
    itemId: item.id,
    itemTitle: item.title,
    visitedAt: '2026-09-24',
    note: 'First note',
    createdAt: '2026-09-24T00:00:00.000Z',
    updatedAt: '2026-09-24T00:00:00.000Z',
  };
  const savedVisit = {
    ...optimisticVisit,
    id: 'visit-saved',
    note: 'Saved note',
  };
  const editedVisit = {
    ...savedVisit,
    visitedAt: '2026-09-25',
    note: 'Edited note',
    updatedAt: '2026-09-25T00:00:00.000Z',
  };
  const optimisticMedia = {
    id: 'media-saved',
    visitId: savedVisit.id,
    itemId: item.id,
    originalFilename: 'ramen.jpg',
    contentUrl: '/api/media/media-saved/content',
  };
  const captionedMedia = {
    ...optimisticMedia,
    caption: 'Shoyu ramen',
  };

  let state = createAtlasViewModelState({ items: [item] });
  state = reduceAtlasViewModelState(state, {
    type: 'visit.prepended',
    visit: optimisticVisit,
  });
  state = reduceAtlasViewModelState(state, {
    type: 'visit.received',
    optimisticId: optimisticVisit.id,
    visit: savedVisit,
  });
  state = reduceAtlasViewModelState(state, {
    type: 'visit.received',
    optimisticId: savedVisit.id,
    visit: editedVisit,
  });
  state = reduceAtlasViewModelState(state, {
    type: 'media.appended',
    media: [optimisticMedia],
  });
  state = reduceAtlasViewModelState(state, {
    type: 'media.received',
    media: captionedMedia,
  });

  assert.equal(state.visits[0].note, 'Edited note');
  assert.equal(state.visits[0].visitedAt, '2026-09-25');
  assert.equal(state.media[0].caption, 'Shoyu ramen');

  state = reduceAtlasViewModelState(state, {
    type: 'media.removed',
    mediaId: captionedMedia.id,
  });
  assert.deepEqual(state.media, []);
  state = reduceAtlasViewModelState(state, {
    type: 'media.appended',
    media: [captionedMedia],
  });
  state = reduceAtlasViewModelState(state, {
    type: 'visit.removed',
    visitId: editedVisit.id,
  });
  assert.deepEqual(state.visits, []);
  assert.deepEqual(state.media, []);
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
  let state = createAtlasViewModelState({
    items: [item],
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

  assert.deepEqual(state.items, []);
  assert.deepEqual(state.visits, []);
  assert.deepEqual(state.media, []);

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
