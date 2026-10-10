import { ownerMutationResponse } from './owner-mutation-response.ts';
import type { createInvocationCoordinator } from '@/product/application/invocation/invocation-coordinator';

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
  coordinator: InvocationCoordinator,
  request: Request,
  id: string,
): Promise<Response> {
  if (!id) return new Response('Atlas item ID is required', { status: 400 });
  return ownerMutationResponse({
    coordinator,
    request,
    operation: 'catalog.delete_item',
    operationInput: { id },
    errors: {
      invalidInput: 'Atlas item ID is required',
      notFound: 'Atlas item not found',
      dependencyFailure: 'The Atlas item could not be deleted.',
    },
  });
}
