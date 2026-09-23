import type {
  AtlasCatalogEntry,
  AtlasItem,
  CatalogProfile,
} from './atlas-item.ts';
import { isAtlasItem, projectCatalog } from './catalog-projection.ts';
import type { CatalogRecordState } from './catalog-state.ts';

export interface CatalogRead {
  list<Profile extends CatalogProfile>(
    profile: Profile,
  ): Promise<readonly CatalogEntryForProfile<Profile>[]>;
  get(id: string): Promise<AtlasCatalogEntry | undefined>;
}

export type CatalogEntryForProfile<Profile extends CatalogProfile> =
  Profile extends 'verified_catalog' ? AtlasItem : AtlasCatalogEntry;

export function createCatalogRead(
  state: CatalogRecordState,
  seedItems: readonly AtlasItem[],
): CatalogRead {
  const readFullCatalog = async () =>
    projectCatalog(await state.readSnapshot(), seedItems);
  return {
    async list<Profile extends CatalogProfile>(profile: Profile) {
      const items = await readFullCatalog();
      return (
        profile === 'verified_catalog'
          ? items.filter(
              (item): item is AtlasItem =>
                isAtlasItem(item) && item.verificationStatus === 'verified',
            )
          : items
      ) as readonly CatalogEntryForProfile<Profile>[];
    },
    async get(id) {
      return (await readFullCatalog()).find((item) => item.id === id);
    },
  };
}
