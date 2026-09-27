import {
  defineOperationGroup,
  type OperationDefinition,
} from '../atlas-application.ts';
import { failure, success, type Result } from '../result.ts';
import type {
  AtlasCatalogEntry,
  AtlasItem,
  AtlasItemEdit,
  CatalogProfile,
  PersonalState,
} from './atlas-item.ts';
import { isAtlasItem } from './catalog-projection.ts';
import type { CatalogRead } from './catalog-read.ts';
import type { CatalogRecordState } from './catalog-state.ts';

export interface ListCatalogInput {
  readonly profile: CatalogProfile;
}

export interface GetCatalogItemInput {
  readonly id: string;
}

export interface CatalogClock {
  now(): string;
}

export interface CatalogWriteDependencies {
  readonly state: CatalogRecordState;
  readonly clock: CatalogClock;
}

export interface UpdateCatalogItemInput extends AtlasItemEdit {
  readonly id: string;
}

export function createCatalogReadOperationGroup(catalog: CatalogRead) {
  const listCatalog: OperationDefinition<
    'catalog.list',
    ListCatalogInput,
    readonly AtlasCatalogEntry[],
    'json'
  > = {
    descriptor: {
      key: 'catalog.list',
      resultKind: 'json',
      effect: 'read',
      validate: validateListCatalogInput,
    },
    async handle(input) {
      try {
        return success(await catalog.list(input.profile));
      } catch {
        return failure(
          'dependency_failure',
          'Atlas items are temporarily unavailable.',
        );
      }
    },
  };

  const getCatalogItem: OperationDefinition<
    'catalog.get',
    GetCatalogItemInput,
    AtlasCatalogEntry,
    'json'
  > = {
    descriptor: {
      key: 'catalog.get',
      resultKind: 'json',
      effect: 'read',
      validate: validateGetCatalogItemInput,
    },
    async handle({ id }) {
      try {
        const item = await catalog.get(id);
        return item
          ? success(item)
          : failure('not_found', 'Atlas item not found.');
      } catch {
        return failure(
          'dependency_failure',
          'Atlas items are temporarily unavailable.',
        );
      }
    },
  };

  return defineOperationGroup({
    'catalog.list': listCatalog,
    'catalog.get': getCatalogItem,
  });
}

export function createCatalogOperationGroup(
  catalog: CatalogRead,
  writeDependencies: CatalogWriteDependencies,
) {
  const saveDiscoveredItem: OperationDefinition<
    'catalog.save_discovered',
    AtlasItem,
    AtlasItem,
    'json'
  > = {
    descriptor: {
      key: 'catalog.save_discovered',
      resultKind: 'json',
      effect: 'write',
      validate: validateDiscoveredItem,
    },
    async handle(item, execution) {
      try {
        const storedAt = writeDependencies.clock.now();
        const stored = { ...item, updatedAt: storedAt };
        await writeDependencies.state.saveDynamicItem(
          stored,
          storedAt,
          execution?.atomicMutation?.receiptFor(stored),
        );
        return success(stored);
      } catch {
        return failure(
          'dependency_failure',
          'The Atlas item could not be saved.',
        );
      }
    },
  };

  const updateCatalogItem: OperationDefinition<
    'catalog.update_item',
    UpdateCatalogItemInput,
    AtlasCatalogEntry,
    'json'
  > = {
    descriptor: {
      key: 'catalog.update_item',
      resultKind: 'json',
      effect: 'write',
      validate: validateUpdateCatalogItem,
    },
    async handle(input, execution) {
      try {
        const existing = await catalog.get(input.id);
        if (!existing) {
          return failure('not_found', 'Atlas item not found.');
        }
        const updatedAt = writeDependencies.clock.now();
        const edit: AtlasItemEdit = {
          title: input.title,
          description: input.description,
          personalState: input.personalState,
        };
        const output = { ...existing, ...edit, updatedAt };
        await writeDependencies.state.saveOverride(
          { itemId: input.id, ...edit, updatedAt },
          execution?.atomicMutation?.receiptFor(output),
        );
        return success(output);
      } catch {
        return failure(
          'dependency_failure',
          'The Atlas item could not be updated.',
        );
      }
    },
  };

  return defineOperationGroup({
    ...createCatalogReadOperationGroup(catalog),
    'catalog.save_discovered': saveDiscoveredItem,
    'catalog.update_item': updateCatalogItem,
  });
}

function validateListCatalogInput(input: unknown): Result<ListCatalogInput> {
  if (!isRecord(input)) {
    return failure('invalid_input', 'A catalog profile is required.');
  }
  if (
    input.profile !== 'verified_catalog' &&
    input.profile !== 'full_merged_catalog'
  ) {
    return failure('invalid_input', 'A valid catalog profile is required.');
  }
  return success({ profile: input.profile });
}

function validateGetCatalogItemInput(
  input: unknown,
): Result<GetCatalogItemInput> {
  if (
    !isRecord(input) ||
    Object.keys(input).length !== 1 ||
    typeof input.id !== 'string' ||
    !input.id
  ) {
    return failure('invalid_input', 'An Atlas item ID is required.');
  }
  return success({ id: input.id });
}

function validateDiscoveredItem(input: unknown): Result<AtlasItem> {
  if (
    isRecord(input) &&
    input.verificationStatus !== undefined &&
    input.verificationStatus !== 'needs_review'
  ) {
    return failure(
      'invalid_input',
      'Collector-created items must enter as needs_review.',
    );
  }
  if (
    !isAtlasItem(input) ||
    !input.id.trim() ||
    !input.title.trim() ||
    !input.description.trim()
  ) {
    return failure('invalid_input', 'A valid Atlas item is required.');
  }
  return success(input);
}

function validateUpdateCatalogItem(
  input: unknown,
): Result<UpdateCatalogItemInput> {
  if (
    !isRecord(input) ||
    typeof input.id !== 'string' ||
    !input.id ||
    typeof input.title !== 'string' ||
    !input.title.trim() ||
    typeof input.description !== 'string' ||
    !input.description.trim() ||
    !isPersonalState(input.personalState)
  ) {
    return failure(
      'invalid_input',
      'Valid title, description, and state are required.',
    );
  }
  return success({
    id: input.id,
    title: input.title.trim(),
    description: input.description.trim(),
    personalState: input.personalState,
  });
}

function isPersonalState(value: unknown): value is PersonalState {
  return (
    value === 'candidate' ||
    value === 'saved' ||
    value === 'planned' ||
    value === 'visited'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
