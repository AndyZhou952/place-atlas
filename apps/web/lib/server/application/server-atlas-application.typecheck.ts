import type { createServerAtlasApplication } from './server-atlas-application';

declare const application: ReturnType<typeof createServerAtlasApplication>;

void application.execute({
  key: 'catalog.list',
  input: { profile: 'full_merged_catalog' },
});
void application.execute({ key: 'catalog.get', input: { id: 'item-1' } });
void application.execute({
  key: 'catalog.intake.discover',
  input: { query: '鮮 さいとう', requestToken: 'request-1' },
});
void application.execute({
  key: 'catalog.intake.select',
  input: {
    sessionId: 'session-1',
    expectedSessionVersion: 1,
    ordinal: 1,
    requestResearch: false,
  },
});
void application.execute({
  key: 'catalog.intake.confirm',
  input: { sessionId: 'session-1', expectedPreviewVersion: 1 },
});
void application.execute({
  key: 'catalog.intake.cancel',
  input: { sessionId: 'session-1', expectedSessionVersion: 1 },
});
void application.execute({
  key: 'catalog.save_discovered',
  input: {
    id: 'item-1',
    kind: 'food',
    title: 'Item',
    area: 'Tokyo',
    address: 'Tokyo address',
    description: 'Description',
    latitude: 35.6812,
    longitude: 139.7671,
    verificationStatus: 'needs_review',
    verifiedAt: '2026-09-12',
    reservation: {
      mode: 'unknown',
      label: 'Unknown',
      checkedAt: '2026-09-12',
    },
    personalState: 'candidate',
    tags: [],
    sources: [],
  },
});
void application.execute({
  key: 'catalog.update_item',
  input: {
    id: 'item-1',
    title: 'Edited',
    description: 'Edited',
    personalState: 'saved',
  },
});
void application.execute({
  key: 'assessment.update',
  input: { itemId: 'item-1', patch: { manualVisited: true } },
});
void application.execute({ key: 'catalog.search', input: { query: '' } });
void application.execute({
  key: 'decision.nearby',
  input: {
    latitude: 35.6812,
    longitude: 139.7671,
    limit: 5,
    profile: 'verified_catalog',
  },
});
void application.execute({ key: 'media.list', input: {} });
void application.execute({
  key: 'media.attach',
  input: {
    visitId: 'visit-1',
    uploads: [
      {
        originalFilename: 'image.jpg',
        contentType: 'image/jpeg',
        bytes: Uint8Array.of(0xff, 0xd8, 0xff),
      },
    ],
  },
});
void application.execute({
  key: 'media.caption',
  input: { id: 'media-1', caption: null },
});
void application.execute({ key: 'media.delete', input: { id: 'media-1' } });
void application.execute({ key: 'visit.list', input: {} });
void application.execute({
  key: 'visit.create',
  input: {
    itemId: 'item-1',
    visitedAt: '2026-09-12',
    rating: 4.2,
  },
});
void application.execute({
  key: 'visit.update',
  input: { id: 'visit-1', visitedAt: '2026-09-12', rating: null },
});
void application.execute({ key: 'visit.delete', input: { id: 'visit-1' } });
void application.execute({
  key: 'catalog.delete_item',
  input: { id: 'item-1' },
});
void application.openMedia({ key: 'media.open', input: { id: 'media-1' } });

// @ts-expect-error media.open is not present in the JSON operation key set.
void application.execute({ key: 'media.open', input: { id: 'media-1' } });
void application.openMedia({
  // @ts-expect-error media.attach is a JSON operation, not a media stream operation.
  key: 'media.attach',
  input: { id: 'media-1' },
});
void application.openMedia({
  // @ts-expect-error catalog.update_item is a JSON operation, not a media stream operation.
  key: 'catalog.update_item',
  input: { id: 'item-1' },
});
// @ts-expect-error runtime operation registration is not part of the static catalog.
void application.execute({ key: 'unregistered.operation', input: {} });
