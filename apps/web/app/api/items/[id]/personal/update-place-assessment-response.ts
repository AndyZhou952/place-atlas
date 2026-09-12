import type { AtlasApplication } from '@/product/application/atlas-application';
import type { createPlaceAssessmentOperationGroup } from '@/product/application/assessments/place-assessment-operations';

type PlaceAssessmentApplication = AtlasApplication<
  ReturnType<typeof createPlaceAssessmentOperationGroup>
>;

interface PersonalItemPatch {
  readonly overallRating?: number | null;
  readonly isFavorite?: boolean;
  readonly hasVisited?: boolean;
  readonly summary?: string | null;
}

export async function updatePlaceAssessmentResponse(
  application: PlaceAssessmentApplication,
  itemId: string,
  input: unknown,
): Promise<Response> {
  if (!isPersonalItemPatch(input)) {
    return new Response('Invalid personal item update', { status: 400 });
  }

  const result = await application.execute({
    key: 'assessment.update',
    input: {
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
  });

  if (!result.ok) {
    if (result.error.kind === 'invalid_input') {
      return new Response('Invalid personal item update', { status: 400 });
    }
    if (result.error.kind === 'not_found') {
      return new Response('Atlas item not found', { status: 404 });
    }
    return new Response('The personal place status could not be saved.', {
      status: 500,
    });
  }

  return Response.json(result.value.item);
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
