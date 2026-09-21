import { ownerMutationResponse } from '../../owner-mutation-response.ts';
import type { createInvocationCoordinator } from '../../../../product/application/invocation/invocation-coordinator.ts';

type InvocationCoordinator = ReturnType<typeof createInvocationCoordinator>;

export async function updateVisitMediaCaptionResponse(
  coordinator: InvocationCoordinator,
  request: Request,
  id: string,
  input: unknown,
): Promise<Response> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return new Response('Caption must be text.', { status: 400 });
  }
  const caption = Reflect.get(input, 'caption');
  if (
    caption !== undefined &&
    caption !== null &&
    typeof caption !== 'string'
  ) {
    return new Response('Caption must be text.', { status: 400 });
  }
  return ownerMutationResponse({
    coordinator,
    request,
    operation: 'media.caption',
    operationInput: { id, caption },
    errors: {
      invalidInput: 'Caption must be text.',
      notFound: 'Photo not found',
      dependencyFailure: 'The photo caption could not be updated.',
    },
  });
}

export async function deleteVisitMediaResponse(
  coordinator: InvocationCoordinator,
  request: Request,
  id: string,
): Promise<Response> {
  return ownerMutationResponse({
    coordinator,
    request,
    operation: 'media.delete',
    operationInput: { id },
    errors: {
      invalidInput: 'Photo ID is required',
      notFound: 'Photo not found',
      dependencyFailure: 'The photo could not be deleted.',
    },
  });
}
