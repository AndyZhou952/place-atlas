import type { AtlasItem, CatalogProfile } from './atlas-item.ts';
import { projectCatalog } from './catalog-projection.ts';
import type { CatalogRecordState } from './catalog-state.ts';

export interface CatalogRead {
  list(profile: CatalogProfile): Promise<readonly AtlasItem[]>;
  get(id: string): Promise<AtlasItem | undefined>;
}

export function createCatalogRead(
  state: CatalogRecordState,
  seedItems: readonly AtlasItem[],
): CatalogRead {
  const readFullCatalog = async () =>
    projectCatalog(await state.readSnapshot(), seedItems);

  return {
    async list(profile) {
      const items = await readFullCatalog();
      return profile === 'verified_catalog'
        ? items.filter((item) => item.verificationStatus === 'verified')
        : items;
    },
    async get(id) {
      return (await readFullCatalog()).find((item) => item.id === id);
    },
  };
}
