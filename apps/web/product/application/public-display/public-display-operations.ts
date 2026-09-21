import type { PlaceAssessmentRecordState } from '../assessments/place-assessment-state.ts';
import { isEffectivelyVisited } from '../assessments/effective-visited.ts';
import {
  defineOperationGroup,
  type OperationDefinition,
} from '../atlas-application.ts';
import type { CatalogRead } from '../catalog/catalog-read.ts';
import type { VisitMediaRecordState } from '../media/media-state.ts';
import type { VisitMediaMetadata } from '../media/visit-media.ts';
import { failure, success, type Result } from '../result.ts';
import type { VisitRecordState } from '../visits/visit-state.ts';
import type { Visit } from '../visits/visit.ts';

type EmptyInput = Readonly<Record<string, never>>;

export interface AssessmentDisplay {
  readonly itemId: string;
  readonly isFavorite: boolean;
  readonly manualVisited: boolean;
  readonly effectiveVisited: boolean;
  readonly overallRating?: number;
  readonly summary?: string;
}

export interface VisitDisplay extends Visit {
  readonly media: readonly VisitMediaMetadata[];
}

export interface PublicDisplayDependencies {
  readonly catalog: CatalogRead;
  readonly assessments: PlaceAssessmentRecordState;
  readonly visits: VisitRecordState;
  readonly media: VisitMediaRecordState;
}

export function createPublicDisplayOperationGroup(
  dependencies: PublicDisplayDependencies,
) {
  const displayAssessment: OperationDefinition<
    'assessment.display',
    { readonly itemId: string },
    AssessmentDisplay,
    'json'
  > = {
    descriptor: {
      key: 'assessment.display',
      resultKind: 'json',
      effect: 'read',
      validate: validateItemId,
    },
    async handle({ itemId }) {
      try {
        if (!(await dependencies.catalog.get(itemId))) {
          return failure('not_found', 'Atlas item not found.');
        }
        const context = await dependencies.assessments.read(itemId);
        const assessment = context.assessment;
        return success({
          itemId,
          isFavorite: assessment?.isFavorite ?? false,
          manualVisited: assessment?.manualVisited ?? false,
          effectiveVisited: isEffectivelyVisited(
            assessment?.manualVisited ?? false,
            context.visitCount,
          ),
          ...(assessment?.overallRating === undefined
            ? {}
            : { overallRating: assessment.overallRating }),
          ...(assessment?.summary === undefined
            ? {}
            : { summary: assessment.summary }),
        });
      } catch {
        return failure(
          'dependency_failure',
          'The personal place status is temporarily unavailable.',
        );
      }
    },
  };

  const listDisplayVisits: OperationDefinition<
    'visit.listDisplay',
    EmptyInput,
    readonly VisitDisplay[],
    'json'
  > = {
    descriptor: {
      key: 'visit.listDisplay',
      resultKind: 'json',
      effect: 'read',
      validate: validateEmptyInput,
    },
    async handle() {
      try {
        return success(
          await assembleVisits(
            await dependencies.visits.list(),
            dependencies.media,
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

  const getDisplayVisit: OperationDefinition<
    'visit.getDisplay',
    { readonly id: string },
    VisitDisplay,
    'json'
  > = {
    descriptor: {
      key: 'visit.getDisplay',
      resultKind: 'json',
      effect: 'read',
      validate: validateVisitId,
    },
    async handle({ id }) {
      try {
        const visit = (await dependencies.visits.list()).find(
          (candidate) => candidate.id === id,
        );
        if (!visit) return failure('not_found', 'Journal entry not found.');
        return success({
          ...visit,
          media: await dependencies.media.list({ visitId: visit.id }),
        });
      } catch {
        return failure(
          'dependency_failure',
          'Journal entries are temporarily unavailable.',
        );
      }
    },
  };

  return defineOperationGroup({
    'assessment.display': displayAssessment,
    'visit.listDisplay': listDisplayVisits,
    'visit.getDisplay': getDisplayVisit,
  });
}

async function assembleVisits(
  visits: readonly Visit[],
  mediaState: VisitMediaRecordState,
): Promise<readonly VisitDisplay[]> {
  const media = await mediaState.list({});
  return [...visits]
    .sort(
      (left, right) =>
        right.visitedAt.localeCompare(left.visitedAt) ||
        right.createdAt.localeCompare(left.createdAt),
    )
    .map((visit) => ({
      ...visit,
      media: media.filter((entry) => entry.visitId === visit.id),
    }));
}

function validateEmptyInput(input: unknown): Result<EmptyInput> {
  return isRecord(input) && Object.keys(input).length === 0
    ? success({})
    : failure('invalid_input', 'This operation does not accept input.');
}

function validateItemId(input: unknown): Result<{ readonly itemId: string }> {
  return isRecord(input) &&
    Object.keys(input).length === 1 &&
    typeof input.itemId === 'string' &&
    Boolean(input.itemId)
    ? success({ itemId: input.itemId })
    : failure('invalid_input', 'An Atlas item ID is required.');
}

function validateVisitId(input: unknown): Result<{ readonly id: string }> {
  return isRecord(input) &&
    Object.keys(input).length === 1 &&
    typeof input.id === 'string' &&
    Boolean(input.id)
    ? success({ id: input.id })
    : failure('invalid_input', 'A Journal entry ID is required.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
