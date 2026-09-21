import {
  defineOperationGroup,
  type OperationDefinition,
} from '../atlas-application.ts';
import type { CatalogRead } from '../catalog/catalog-read.ts';
import { failure, success, type Result } from '../result.ts';
import { normalizeAssessmentRating } from './assessment-rating.ts';
import { isEffectivelyVisited } from './effective-visited.ts';
import type {
  PlaceAssessment,
  PlaceAssessmentMutation,
  PlaceAssessmentMutationResult,
  PlaceAssessmentPatch,
} from './place-assessment.ts';
import type { PlaceAssessmentRecordState } from './place-assessment-state.ts';

export interface PlaceAssessmentClock {
  now(): string;
}

export interface PlaceAssessmentDependencies {
  readonly clock: PlaceAssessmentClock;
}

export function createPlaceAssessmentOperationGroup(
  catalog: CatalogRead,
  state: PlaceAssessmentRecordState,
  dependencies: PlaceAssessmentDependencies,
) {
  const updateAssessment: OperationDefinition<
    'assessment.update',
    PlaceAssessmentMutation,
    PlaceAssessmentMutationResult,
    'json'
  > = {
    descriptor: {
      key: 'assessment.update',
      resultKind: 'json',
      effect: 'write',
      validate: validateMutation,
    },
    async handle({ itemId, patch }, execution) {
      try {
        const item = await catalog.get(itemId);
        if (!item) return failure('not_found', 'Atlas item not found.');

        const context = await state.read(itemId);
        const assessment = applyPatch(
          itemId,
          context.assessment,
          patch,
          dependencies.clock.now(),
        );
        const output = {
          assessment,
          item: {
            ...item,
            personalRating: assessment.overallRating,
            isFavorite: assessment.isFavorite,
            hasVisited: isEffectivelyVisited(
              assessment.manualVisited,
              context.visitCount,
            ),
            overallComment: assessment.summary,
          },
        };
        await state.save(
          assessment,
          execution?.atomicMutation?.receiptFor(output),
        );

        return success(output);
      } catch {
        return failure(
          'dependency_failure',
          'The personal place status could not be saved.',
        );
      }
    },
  };

  return defineOperationGroup({ 'assessment.update': updateAssessment });
}

function applyPatch(
  itemId: string,
  current: PlaceAssessment | undefined,
  patch: PlaceAssessmentPatch,
  updatedAt: string,
): PlaceAssessment {
  const overallRating =
    patch.overallRating === null
      ? undefined
      : patch.overallRating === undefined
        ? current?.overallRating
        : normalizeAssessmentRating(patch.overallRating);
  const summary =
    patch.summary === undefined
      ? current?.summary
      : patch.summary?.trim() || undefined;

  return {
    itemId,
    ...(overallRating === undefined ? {} : { overallRating }),
    isFavorite: patch.isFavorite ?? current?.isFavorite ?? false,
    manualVisited: patch.manualVisited ?? current?.manualVisited ?? false,
    ...(summary === undefined ? {} : { summary }),
    updatedAt,
  };
}

function validateMutation(input: unknown): Result<PlaceAssessmentMutation> {
  if (!isRecord(input) || !isRecord(input.patch)) {
    return invalidMutation();
  }
  if (typeof input.itemId !== 'string' || !input.itemId.trim()) {
    return invalidMutation();
  }

  const patch = input.patch;
  if (
    (patch.overallRating !== undefined &&
      patch.overallRating !== null &&
      (typeof patch.overallRating !== 'number' ||
        !Number.isFinite(patch.overallRating) ||
        patch.overallRating < 0 ||
        patch.overallRating > 5)) ||
    (patch.isFavorite !== undefined && typeof patch.isFavorite !== 'boolean') ||
    (patch.manualVisited !== undefined &&
      typeof patch.manualVisited !== 'boolean') ||
    (patch.summary !== undefined &&
      patch.summary !== null &&
      typeof patch.summary !== 'string')
  ) {
    return invalidMutation();
  }

  return success({
    itemId: input.itemId,
    patch: {
      ...(patch.overallRating === undefined
        ? {}
        : { overallRating: patch.overallRating }),
      ...(patch.isFavorite === undefined
        ? {}
        : { isFavorite: patch.isFavorite }),
      ...(patch.manualVisited === undefined
        ? {}
        : { manualVisited: patch.manualVisited }),
      ...(patch.summary === undefined ? {} : { summary: patch.summary }),
    },
  });
}

function invalidMutation(): Result<never> {
  return failure('invalid_input', 'Invalid personal item update.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
