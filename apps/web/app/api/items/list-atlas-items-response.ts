import type { AtlasApplication } from '@/product/application/atlas-application';
import type { createCatalogReadOperationGroup } from '@/product/application/catalog/catalog-operations';
import {
  createPublicReadManifest,
  executePublicJsonRead,
} from '../../../lib/server/public-read/public-read-manifest.ts';

type CatalogApplication = AtlasApplication<
  ReturnType<typeof createCatalogReadOperationGroup>
>;

export async function listAtlasItemsResponse(
  application: CatalogApplication,
): Promise<Response> {
  return executePublicJsonRead({
    manifest: createPublicReadManifest(),
    operation: 'catalog.list',
    principal: { kind: 'anonymous' },
    async load() {
      const result = await application.execute({
        key: 'catalog.list',
        input: { profile: 'full_merged_catalog' },
      });
      if (!result.ok) throw new Error('catalog unavailable');
      return result.value;
    },
  });
}
