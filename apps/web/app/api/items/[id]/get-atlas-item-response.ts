import type { AtlasApplication } from '@/product/application/atlas-application';
import type { createCatalogReadOperationGroup } from '@/product/application/catalog/catalog-operations';

type CatalogApplication = AtlasApplication<
  ReturnType<typeof createCatalogReadOperationGroup>
>;

export async function getAtlasItemResponse(
  application: CatalogApplication,
  id: string,
): Promise<Response> {
  const result = await application.execute({
    key: 'catalog.get',
    input: { id },
  });
  if (!result.ok) {
    const status =
      result.error.kind === 'invalid_input'
        ? 400
        : result.error.kind === 'not_found'
          ? 404
          : 500;
    return new Response(
      status === 404
        ? 'Atlas item not found'
        : status === 400
          ? 'An Atlas item ID is required'
          : 'Atlas items are temporarily unavailable.',
      { status },
    );
  }
  return Response.json(result.value);
}
