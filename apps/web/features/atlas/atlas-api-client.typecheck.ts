import type { BrowserAtlasApplication } from './atlas-api-client';

declare const application: BrowserAtlasApplication;

void application.execute({
  key: 'visit.update',
  input: {
    id: 'visit-1',
    visitedAt: '2026-09-12',
    rating: null,
  },
});

void application.execute({
  key: 'media.attach',
  input: { visitId: 'visit-1', files: [], uploadIds: [] },
});

void application.execute({
  key: 'nearby.recommend',
  input: { locationHint: '銀座' },
});

void application.execute({
  key: 'nearby.recommend',
  // @ts-expect-error Structured Nearby requires a location hint.
  input: {},
});

void application.execute({
  key: 'decision.nearby',
  input: {
    latitude: 35.68,
    longitude: 139.76,
    limit: 5,
    profile: 'full_merged_catalog',
  },
});

void application.execute({
  key: 'decision.nearby',
  input: {
    latitude: 35.68,
    longitude: 139.76,
    limit: 5,
    // @ts-expect-error Browser nearby exposes only the two Application profiles.
    profile: 'favorites',
  },
});

void application.execute({
  key: 'visit.update',
  // @ts-expect-error Visit update input and output stay correlated to the key.
  input: { id: 'visit-1' },
});

// @ts-expect-error Browser callers cannot invent an operation outside the map.
void application.execute({ key: 'database.query', input: {} });
