import {
  defineOperationGroup,
  type OperationDefinition,
} from '../atlas-application.ts';
import type { VisitItemProjection } from '../visits/visit-item-projection.ts';
import type { VisitTarget } from '../visits/visit-target.ts';
import { failure, success, type Result } from '../result.ts';
import type {
  DestructiveItemProjection,
  DestructiveMediaObjects,
  DestructiveRecordState,
} from './destructive-state.ts';

export interface DeleteVisitResult {
  readonly item: VisitTarget;
}

export interface DeleteAtlasItemResult {
  readonly id: string;
  readonly deleted: true;
}

export interface DestructiveDependencies {
  readonly clock: { now(): string };
}

export function createDestructiveOperationGroup(
  state: DestructiveRecordState,
  itemProjection: DestructiveItemProjection,
  visitItemProjection: VisitItemProjection,
  objects: DestructiveMediaObjects,
  dependencies: DestructiveDependencies,
) {
  const deleteVisit: OperationDefinition<
    'visit.delete',
    { readonly id: string },
    DeleteVisitResult,
    'json'
  > = {
    descriptor: {
      key: 'visit.delete',
      resultKind: 'json',
      effect: 'destructive',
      validate: validateId,
    },
    async handle({ id }, execution) {
      try {
        const context = await state.readVisitDeletion(id);
        if (!context) {
          return failure('not_found', 'Journal entry not found.');
        }
        const item = visitItemProjection.project(context);
        if (!item) return failure('not_found', 'Atlas item not found.');

        const output = {
          item: visitItemProjection.project({
            ...context,
            visitCount: Math.max(0, context.visitCount - 1),
          })!,
        };
        await state.commitVisitDeletion(
          id,
          execution?.atomicMutation?.receiptFor(output),
        );
        await deleteObjectsBestEffort(objects, context.mediaObjectKeys);
        return success(output);
      } catch {
        return failure(
          'dependency_failure',
          'The Journal entry could not be deleted.',
        );
      }
    },
  };

  const deleteAtlasItem: OperationDefinition<
    'catalog.delete_item',
    { readonly id: string },
    DeleteAtlasItemResult,
    'json'
  > = {
    descriptor: {
      key: 'catalog.delete_item',
      resultKind: 'json',
      effect: 'destructive',
      validate: validateId,
    },
    async handle({ id }) {
      try {
        const context = await state.readItemDeletion(id);
        if (!itemProjection.project(context)) {
          return failure('not_found', 'Atlas item not found.');
        }

        await state.commitItemDeletion(id, dependencies.clock.now());
        await deleteObjectsBestEffort(objects, context.mediaObjectKeys);
        return success({ id, deleted: true });
      } catch {
        return failure(
          'dependency_failure',
          'The Atlas item could not be deleted.',
        );
      }
    },
  };

  return defineOperationGroup({
    'visit.delete': deleteVisit,
    'catalog.delete_item': deleteAtlasItem,
  });
}

function validateId(input: unknown): Result<{ readonly id: string }> {
  if (!isRecord(input) || typeof input.id !== 'string' || !input.id.trim()) {
    return failure('invalid_input', 'An ID is required.');
  }
  return success({ id: input.id });
}

async function deleteObjectsBestEffort(
  objects: DestructiveMediaObjects,
  keys: readonly string[],
): Promise<void> {
  await Promise.allSettled(
    keys.map((key) => Promise.resolve().then(() => objects.delete(key))),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
