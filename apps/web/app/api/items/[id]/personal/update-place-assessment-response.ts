import { ownerMutationResponse } from '../../../owner-mutation-response.ts';
import type { createInvocationCoordinator } from '../../../../../product/application/invocation/invocation-coordinator.ts';

type InvocationCoordinator = ReturnType<typeof createInvocationCoordinator>;

interface PersonalItemPatch {
  readonly overallRating?: number | null;
  readonly isFavorite?: boolean;
  readonly hasVisited?: boolean;
  readonly summary?: string | null;
}

export async function updatePlaceAssessmentResponse(
  coordinator: InvocationCoordinator,
  request: Request,
  itemId: string,
  input: unknown,
): Promise<Response> {
  if (!isPersonalItemPatch(input)) {
    return new Response('Invalid personal item update', { status: 400 });
  }

  return ownerMutationResponse({
    coordinator,
    request,
    operation: 'assessment.update',
    operationInput: {
      itemId,
      patch: {
        ...(input.overallRating === undefined
          ? {}
          : { overallRating: input.overallRating }),
        ...(input.isFavorite === undefined
          ? {}
          : { isFavorite: input.isFavorite }),
        ...(input.hasVisited === undefined
          ? {}
          : { manualVisited: input.hasVisited }),
        ...(input.summary === undefined ? {} : { summary: input.summary }),
      },
    },
    projectResult: projectAssessmentMutationResult,
    errors: {
      invalidInput: 'Invalid personal item update',
      notFound: 'Atlas item not found',
      dependencyFailure: 'The personal place status could not be saved.',
    },
  });
}

function projectAssessmentMutationResult(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.item)) return value;

  return {
    ...value,
    item: {
      ...value.item,
      personalRating: value.item.personalRating ?? null,
      overallComment: value.item.overallComment ?? null,
    },
  };
}

function isPersonalItemPatch(value: unknown): value is PersonalItemPatch {
  if (!isRecord(value)) return false;
  return (
    (value.isFavorite === undefined || typeof value.isFavorite === 'boolean') &&
    (value.hasVisited === undefined || typeof value.hasVisited === 'boolean') &&
    (value.overallRating === undefined ||
      value.overallRating === null ||
      (typeof value.overallRating === 'number' &&
        Number.isFinite(value.overallRating) &&
        value.overallRating >= 0 &&
        value.overallRating <= 5)) &&
    (value.summary === undefined ||
      value.summary === null ||
      typeof value.summary === 'string')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
