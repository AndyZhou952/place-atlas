import type { AtlasApplication } from '@/product/application/atlas-application';
import type { createDestructiveOperationGroup } from '@/product/application/destructive/destructive-operations';
import { ownerMutationResponse } from './owner-mutation-response.ts';
import type { createInvocationCoordinator } from '@/product/application/invocation/invocation-coordinator';

type DestructiveApplication = AtlasApplication<
  ReturnType<typeof createDestructiveOperationGroup>
>;
type InvocationCoordinator = ReturnType<typeof createInvocationCoordinator>;

export async function deleteVisitResponse(
  coordinator: InvocationCoordinator,
  request: Request,
  id: string,
): Promise<Response> {
  if (!id) {
    return new Response('Journal entry ID is required', { status: 400 });
  }
  return ownerMutationResponse({
    coordinator,
    request,
    operation: 'visit.delete',
    operationInput: { id },
    errors: {
      invalidInput: 'Journal entry ID is required',
      notFound: 'Journal entry not found',
      dependencyFailure: 'The Journal entry could not be deleted.',
    },
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
