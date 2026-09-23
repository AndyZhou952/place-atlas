import type { CatalogRead } from '../catalog/catalog-read.ts';

export interface PublicDisplayRecord {
  readonly itemId: string;
}

export interface PublicDisplayAccess {
  allowsItem(itemId: string): Promise<boolean>;
  filterAllowed<Display extends PublicDisplayRecord>(
    records: readonly Display[],
  ): Promise<readonly Display[]>;
}

export function createPublicDisplayAccess(
  catalog: CatalogRead,
): PublicDisplayAccess {
  async function verifiedIds() {
    return new Set(
      (await catalog.list('verified_catalog')).map(({ id }) => id),
    );
  }

  return {
    async allowsItem(itemId) {
      return (await verifiedIds()).has(itemId);
    },
    async filterAllowed(records) {
      const allowed = await verifiedIds();
      return records.filter(({ itemId }) => allowed.has(itemId));
    },
  };
}

export const unavailablePublicDisplayAccess: PublicDisplayAccess = {
  async allowsItem() {
    return false;
  },
  async filterAllowed() {
    return [];
  },
};
