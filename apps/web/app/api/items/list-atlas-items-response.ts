import type { AtlasApplication } from '@/product/application/atlas-application';
import type { createCatalogReadOperationGroup } from '@/product/application/catalog/catalog-operations';

type CatalogApplication = AtlasApplication<
  ReturnType<typeof createCatalogReadOperationGroup>
>;

export async function listAtlasItemsResponse(
  application: CatalogApplication,
): Promise<Response> {
  const result = await application.execute({
    key: 'catalog.list',
    input: { profile: 'full_merged_catalog' },
  });
  if (!result.ok) {
    return new Response('Atlas items are temporarily unavailable.', {
      status: 500,
    });
  }
  return Response.json(result.value);
}
