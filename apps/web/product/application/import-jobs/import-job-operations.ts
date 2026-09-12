import {
  defineOperationGroup,
  type OperationDefinition,
} from '../atlas-application.ts';
import { failure, success, type Result } from '../result.ts';
import type { ImportJob, NewImportJob } from './import-job.ts';
import type { ImportJobRecordState } from './import-job-state.ts';

export type EmptyInput = Readonly<Record<string, never>>;
export interface DeleteImportJobInput {
  readonly id: string;
}

export interface DeleteImportJobOutput {
  readonly id: string;
  readonly deleted: true;
}

export interface ImportJobClock {
  now(): string;
}

export interface ImportJobIdSource {
  nextId(): string;
}

export interface ImportJobDependencies {
  readonly clock: ImportJobClock;
  readonly idSource: ImportJobIdSource;
}

export function createImportJobOperationGroup(
  state: ImportJobRecordState,
  dependencies: ImportJobDependencies,
) {
  const listImportJobs: OperationDefinition<
    'import.list',
    EmptyInput,
    readonly ImportJob[],
    'json'
  > = {
    descriptor: {
      key: 'import.list',
      resultKind: 'json',
      effect: 'read',
      validate: validateEmptyInput,
    },
    async handle() {
      try {
        const jobs = await state.list();
        return success(
          [...jobs].sort((left, right) =>
            right.createdAt.localeCompare(left.createdAt),
          ),
        );
      } catch {
        return failure(
          'dependency_failure',
          'Import jobs are temporarily unavailable.',
        );
      }
    },
  };

  const queueImportJob: OperationDefinition<
    'import.queue',
    NewImportJob,
    ImportJob,
    'json'
  > = {
    descriptor: {
      key: 'import.queue',
      resultKind: 'json',
      effect: 'write',
      validate: validateNewImportJob,
    },
    async handle(input) {
      try {
        const now = dependencies.clock.now();
        const job: ImportJob = {
          id: dependencies.idSource.nextId(),
          sourceRef: input.sourceRef,
          creatorName: input.creatorName,
          platform: input.platform ?? inferPlatform(input.sourceRef),
          status: 'queued',
          discoveredCount: 0,
          needsReviewCount: 0,
          createdAt: now,
          updatedAt: now,
          message: 'Waiting for the collector worker.',
        };
        await state.insert(job);
        return success(job);
      } catch {
        return failure(
          'dependency_failure',
          'The import job could not be queued.',
        );
      }
    },
  };

  const deleteImportJob: OperationDefinition<
    'import.delete',
    DeleteImportJobInput,
    DeleteImportJobOutput,
    'json'
  > = {
    descriptor: {
      key: 'import.delete',
      resultKind: 'json',
      effect: 'destructive',
      validate: validateDeleteImportJob,
    },
    async handle(input) {
      try {
        const deleted = await state.delete(input.id);
        if (!deleted) {
          return failure('not_found', 'Import job not found.');
        }
        return success({ id: input.id, deleted: true });
      } catch {
        return failure(
          'dependency_failure',
          'The import job could not be deleted.',
        );
      }
    },
  };

  return defineOperationGroup({
    'import.list': listImportJobs,
    'import.queue': queueImportJob,
    'import.delete': deleteImportJob,
  });
}

function validateEmptyInput(input: unknown): Result<EmptyInput> {
  if (
    input !== null &&
    typeof input === 'object' &&
    !Array.isArray(input) &&
    Object.keys(input).length === 0
  ) {
    return success({});
  }
  return failure('invalid_input', 'This operation does not accept input.');
}

function validateNewImportJob(input: unknown): Result<NewImportJob> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return failure(
      'invalid_input',
      'Creator name and source reference are required.',
    );
  }
  const candidate = input as Partial<NewImportJob>;
  if (
    typeof candidate.sourceRef !== 'string' ||
    !candidate.sourceRef.trim() ||
    typeof candidate.creatorName !== 'string' ||
    !candidate.creatorName.trim() ||
    (candidate.platform !== undefined && typeof candidate.platform !== 'string')
  ) {
    return failure(
      'invalid_input',
      'Creator name and source reference are required.',
    );
  }
  return success({
    sourceRef: candidate.sourceRef.trim(),
    creatorName: candidate.creatorName.trim(),
    platform: candidate.platform,
  });
}

function validateDeleteImportJob(input: unknown): Result<DeleteImportJobInput> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return failure('invalid_input', 'Import job ID is required.');
  }
  const candidate = input as Partial<DeleteImportJobInput>;
  if (typeof candidate.id !== 'string' || !candidate.id.trim()) {
    return failure('invalid_input', 'Import job ID is required.');
  }
  return success({ id: candidate.id });
}

function inferPlatform(sourceRef: string): string {
  const value = sourceRef.toLocaleLowerCase();
  if (value.includes('xiaohongshu') || value.startsWith('rednote:')) {
    return 'Xiaohongshu';
  }
  if (value.includes('bilibili') || value.startsWith('bilibili:')) {
    return 'Bilibili';
  }
  if (value.includes('youtube')) return 'YouTube';
  if (value.includes('x.com') || value.startsWith('x:')) return 'X';
  return 'Web';
}
