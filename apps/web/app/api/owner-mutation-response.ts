import type { createInvocationCoordinator } from '@/product/application/invocation/invocation-coordinator';

export const atlasMutationIdHeader = 'x-atlas-mutation-id';

type InvocationCoordinator = ReturnType<typeof createInvocationCoordinator>;

interface ErrorMessages {
  readonly invalidInput: string;
  readonly notFound: string;
  readonly dependencyFailure: string;
}

export async function ownerMutationResponse(input: {
  readonly coordinator: InvocationCoordinator;
  readonly request: Request;
  readonly operation: string;
  readonly operationInput: unknown;
  readonly successStatus?: number;
  readonly projectResult?: (result: unknown) => unknown;
  readonly errors: ErrorMessages;
}): Promise<Response> {
  const mutationId = input.request.headers.get(atlasMutationIdHeader);
  if (!mutationId) {
    return new Response('A valid mutation ID is required.', { status: 400 });
  }
  const result = await input.coordinator.mutate({
    operation: input.operation,
    input: input.operationInput,
    mutationId,
    invocation: {
      principal: 'owner',
      channel: 'web',
      scopes: ['atlas:owner'],
      requestedAt: new Date().toISOString(),
    },
  });
  if (result.ok) {
    const value = input.projectResult
      ? {
          ...result.value,
          result: input.projectResult(result.value.result),
        }
      : result.value;
    return Response.json(value, { status: input.successStatus ?? 200 });
  }
  switch (result.error.kind) {
    case 'invalid_input':
      return new Response(input.errors.invalidInput, { status: 400 });
    case 'not_found':
      return new Response(input.errors.notFound, { status: 404 });
    case 'conflict':
      return new Response('The mutation conflicts with an earlier request.', {
        status: 409,
      });
    case 'in_progress':
      return new Response('The mutation is already in progress.', {
        status: 503,
        headers: { 'retry-after': '1' },
      });
    case 'dependency_failure':
    case 'unexpected_failure':
      return new Response(input.errors.dependencyFailure, { status: 500 });
  }
}

export function ownerPocWriteUnavailableResponse(): Response {
  return new Response('This write is not enabled in the Owner PoC.', {
    status: 503,
  });
}
