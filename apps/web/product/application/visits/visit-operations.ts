import { normalizeAssessmentRating } from '../assessments/assessment-rating.ts';
import type { PlaceAssessment } from '../assessments/place-assessment.ts';
import {
  defineOperationGroup,
  type OperationDefinition,
} from '../atlas-application.ts';
import { failure, success, type Result } from '../result.ts';
import type { VisitItemProjection } from './visit-item-projection.ts';
import type {
  NewVisit,
  Visit,
  VisitMutationResult,
  VisitUpdate,
} from './visit.ts';
import type { VisitRecordState } from './visit-state.ts';

type EmptyInput = Readonly<Record<string, never>>;

export interface VisitDependencies {
  readonly clock: { now(): string };
  readonly idSource: { nextId(): string };
}

export function createVisitOperationGroup(
  state: VisitRecordState,
  itemProjection: VisitItemProjection,
  dependencies: VisitDependencies,
) {
  const listVisits: OperationDefinition<
    'visit.list',
    EmptyInput,
    readonly Visit[],
    'json'
  > = {
    descriptor: {
      key: 'visit.list',
      resultKind: 'json',
      effect: 'read',
      validate: validateEmptyInput,
    },
    async handle() {
      try {
        return success(
          [...(await state.list())].sort(
            (left, right) =>
              right.visitedAt.localeCompare(left.visitedAt) ||
              right.createdAt.localeCompare(left.createdAt),
          ),
        );
      } catch {
        return failure(
          'dependency_failure',
          'Journal entries are temporarily unavailable.',
        );
      }
    },
  };

  const createVisit: OperationDefinition<
    'visit.create',
    NewVisit,
    VisitMutationResult,
    'json'
  > = {
    descriptor: {
      key: 'visit.create',
      resultKind: 'json',
      effect: 'write',
      validate: validateNewVisit,
    },
    async handle(input, execution) {
      try {
        const context = await state.readItemContext(input.itemId);
        const item = itemProjection.project(context);
        if (!item) return failure('not_found', 'Atlas item not found.');

        const now = dependencies.clock.now();
        const visit: Visit = {
          id: input.id ?? dependencies.idSource.nextId(),
          itemId: item.id,
          itemTitle: item.title,
          visitedAt: input.visitedAt,
          note: normalizeNote(input.note),
          createdAt: now,
          updatedAt: now,
        };
        const assessment = assessmentWithRating(
          context.assessment,
          item.id,
          input.rating,
          now,
        );
        const projectedItem = itemProjection.project({
          ...context,
          assessment: assessment ?? context.assessment,
          visitCount: context.visitCount + 1,
        })!;
        const output = { visit, item: projectedItem };
        const { inserted } = await state.create(
          { visit, assessment },
          execution?.atomicMutation?.receiptFor(output),
        );
        return success({
          visit,
          item: itemProjection.project({
            ...context,
            assessment: assessment ?? context.assessment,
            visitCount: context.visitCount + (inserted ? 1 : 0),
          })!,
        });
      } catch {
        return failure(
          'dependency_failure',
          'The Journal entry could not be saved.',
        );
      }
    },
  };

  const updateVisit: OperationDefinition<
    'visit.update',
    VisitUpdate,
    VisitMutationResult,
    'json'
  > = {
    descriptor: {
      key: 'visit.update',
      resultKind: 'json',
      effect: 'write',
      validate: validateVisitUpdate,
    },
    async handle(input, execution) {
      try {
        const context = await state.readVisitContext(input.id);
        if (!context) {
          return failure('not_found', 'Journal entry not found.');
        }
        const item = itemProjection.project(context);
        if (!item) return failure('not_found', 'Atlas item not found.');

        const now = dependencies.clock.now();
        const visit: Visit = {
          ...context.visit,
          visitedAt: input.visitedAt,
          note: normalizeNote(input.note),
          updatedAt: now,
        };
        const assessment =
          input.rating === undefined
            ? undefined
            : assessmentWithRating(
                context.assessment,
                item.id,
                input.rating,
                now,
              );
        const output = {
          visit,
          item: itemProjection.project({
            ...context,
            assessment: assessment ?? context.assessment,
          })!,
        };
        await state.update(
          { visit, assessment },
          execution?.atomicMutation?.receiptFor(output),
        );
        return success(output);
      } catch {
        return failure(
          'dependency_failure',
          'The Journal entry could not be updated.',
        );
      }
    },
  };

  return defineOperationGroup({
    'visit.list': listVisits,
    'visit.create': createVisit,
    'visit.update': updateVisit,
  });
}

function assessmentWithRating(
  current: PlaceAssessment | undefined,
  itemId: string,
  rating: number | null | undefined,
  updatedAt: string,
): PlaceAssessment | undefined {
  if (rating === undefined) return undefined;
  const overallRating =
    rating === null ? undefined : normalizeAssessmentRating(rating);
  return {
    itemId,
    ...(overallRating === undefined ? {} : { overallRating }),
    isFavorite: current?.isFavorite ?? false,
    manualVisited: current?.manualVisited ?? false,
    ...(current?.summary === undefined ? {} : { summary: current.summary }),
    updatedAt,
  };
}

function normalizeNote(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function validateEmptyInput(input: unknown): Result<EmptyInput> {
  return isRecord(input) && Object.keys(input).length === 0
    ? success({})
    : failure('invalid_input', 'This operation does not accept input.');
}

function validateNewVisit(input: unknown): Result<NewVisit> {
  if (!isRecord(input)) return invalidNewVisit();
  if (
    (input.id !== undefined &&
      (typeof input.id !== 'string' || !input.id.trim())) ||
    typeof input.itemId !== 'string' ||
    !input.itemId ||
    typeof input.visitedAt !== 'string' ||
    !input.visitedAt ||
    (input.rating === undefined &&
      !(typeof input.note === 'string' && input.note.trim())) ||
    (input.rating !== undefined && !isRating(input.rating)) ||
    (input.note !== undefined && typeof input.note !== 'string')
  ) {
    return invalidNewVisit();
  }
  return success({
    ...(typeof input.id === 'string' ? { id: input.id.trim() } : {}),
    itemId: input.itemId,
    visitedAt: input.visitedAt,
    ...(typeof input.rating === 'number' ? { rating: input.rating } : {}),
    ...(typeof input.note === 'string' ? { note: input.note } : {}),
  });
}

function validateVisitUpdate(input: unknown): Result<VisitUpdate> {
  if (
    !isRecord(input) ||
    typeof input.id !== 'string' ||
    !input.id ||
    typeof input.visitedAt !== 'string' ||
    !input.visitedAt ||
    (input.note !== undefined && typeof input.note !== 'string') ||
    (input.rating !== undefined &&
      input.rating !== null &&
      !isRating(input.rating))
  ) {
    return failure('invalid_input', 'Invalid visit update.');
  }
  return success({
    id: input.id,
    visitedAt: input.visitedAt,
    ...(typeof input.note === 'string' ? { note: input.note } : {}),
    ...(input.rating === undefined ? {} : { rating: input.rating }),
  });
}

function invalidNewVisit(): Result<never> {
  return failure(
    'invalid_input',
    'Valid place and date are required; add at least a rating or note, and keep ratings between 0 and 5.',
  );
}

function isRating(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 5
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
