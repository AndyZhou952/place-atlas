import type { AtlasApplication } from '@/product/application/atlas-application';
import type { createDestructiveOperationGroup } from '@/product/application/destructive/destructive-operations';

type DestructiveApplication = AtlasApplication<
  ReturnType<typeof createDestructiveOperationGroup>
>;

export async function deleteVisitResponse(
  application: DestructiveApplication,
  id: string,
): Promise<Response> {
  if (!id) {
    return new Response('Journal entry ID is required', { status: 400 });
  }
  const result = await application.execute({
    key: 'visit.delete',
    input: { id },
  });
  if (result.ok) return Response.json(result.value);
  if (result.error.kind === 'invalid_input') {
    return new Response('Journal entry ID is required', { status: 400 });
  }
  if (result.error.kind === 'not_found') {
    return new Response('Journal entry not found', { status: 404 });
  }
  return new Response('The Journal entry could not be deleted.', {
    status: 500,
  });
}

export async function deleteAtlasItemResponse(
  application: DestructiveApplication,
  id: string,
): Promise<Response> {
  if (!id) return new Response('Atlas item ID is required', { status: 400 });
  const result = await application.execute({
    key: 'catalog.delete_item',
    input: { id },
  });
  if (result.ok) return Response.json(result.value);
  if (result.error.kind === 'invalid_input') {
    return new Response('Atlas item ID is required', { status: 400 });
  }
  if (result.error.kind === 'not_found') {
    return new Response('Atlas item not found', { status: 404 });
  }
  return new Response('The Atlas item could not be deleted.', { status: 500 });
}
