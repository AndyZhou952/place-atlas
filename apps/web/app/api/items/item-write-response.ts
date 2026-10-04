import type { AtlasApplication } from '@/product/application/atlas-application';
import type {
  AtlasItem,
  AtlasItemEdit,
} from '@/product/application/catalog/atlas-item';
import type { createCatalogOperationGroup } from '@/product/application/catalog/catalog-operations';

type CatalogApplication = AtlasApplication<
  ReturnType<typeof createCatalogOperationGroup>
>;

export async function saveDiscoveredItemResponse(
  application: CatalogApplication,
  item: AtlasItem,
): Promise<Response> {
  const result = await application.execute({
    key: 'catalog.save_discovered',
    input: item,
  });
  if (result.ok) return Response.json(result.value, { status: 201 });

  if (result.error.kind === 'invalid_input') {
    return new Response(
      result.error.message.startsWith('Collector-created')
        ? 'Collector-created items must enter as needs_review'
        : 'id, title, kind, and description are required',
      { status: 400 },
    );
  }
  return new Response('The Atlas item could not be saved.', { status: 500 });
}

export async function updateAtlasItemResponse(
  application: CatalogApplication,
  id: string,
  edit: AtlasItemEdit,
): Promise<Response> {
  const result = await application.execute({
    key: 'catalog.update_item',
    input: { id, ...edit },
  });
  if (result.ok) return Response.json(result.value);

  if (result.error.kind === 'invalid_input') {
    return new Response('Valid title, description, and state are required', {
      status: 400,
    });
  }
  if (result.error.kind === 'not_found') {
    return new Response('Atlas item not found', { status: 404 });
  }
  return new Response('The Atlas item could not be updated.', { status: 500 });
}
