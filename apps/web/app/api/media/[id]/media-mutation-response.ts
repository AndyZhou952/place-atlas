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

export async function updateVisitMediaScoreResponse(
  coordinator: InvocationCoordinator,
  request: Request,
  id: string,
  input: unknown,
): Promise<Response> {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    !Object.prototype.hasOwnProperty.call(input, 'score') ||
    Object.keys(input).some((key) => key !== 'score')
  ) {
    return new Response('Media score must be from 0 to 5.', { status: 400 });
  }
  const score = Reflect.get(input, 'score');
  if (
    score !== null &&
    (typeof score !== 'number' ||
      !Number.isFinite(score) ||
      score < 0 ||
      score > 5)
  ) {
    return new Response('Media score must be from 0 to 5.', { status: 400 });
  }
  return ownerMutationResponse({
    coordinator,
    request,
    operation: 'media.score',
    operationInput: { id, score },
    errors: {
      invalidInput: 'Media score must be from 0 to 5.',
      notFound: 'Media not found',
      dependencyFailure: 'The media score could not be updated.',
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
