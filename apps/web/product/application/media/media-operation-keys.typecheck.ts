import { createAtlasApplication } from '../atlas-application.ts';
import { createMediaOperationGroup } from './media-operations.ts';
import {
  InMemoryMediaObjectStore,
  InMemoryVisitMediaState,
} from './media-read-memory.ts';

const application = createAtlasApplication(
  createMediaOperationGroup(
    new InMemoryVisitMediaState(),
    new InMemoryMediaObjectStore(),
    {
      clock: { now: () => '2026-09-12T00:00:00.000Z' },
      idSource: { nextId: () => 'media-1' },
      digest: async () => 'digest',
    },
  ),
);

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
void application.openMedia({ key: 'media.open', input: { id: 'media-1' } });

// @ts-expect-error media.open is not a JSON operation.
void application.execute({ key: 'media.open', input: { id: 'media-1' } });
// @ts-expect-error media.list is not a media stream operation.
void application.openMedia({ key: 'media.list', input: {} });
