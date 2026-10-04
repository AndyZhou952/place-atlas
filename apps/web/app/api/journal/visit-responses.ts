import type { AtlasApplication } from '@/product/application/atlas-application';
import type { createVisitOperationGroup } from '@/product/application/visits/visit-operations';
import { ownerMutationResponse } from '../owner-mutation-response.ts';
import type { createInvocationCoordinator } from '../../../product/application/invocation/invocation-coordinator.ts';

type VisitApplication = AtlasApplication<
  ReturnType<typeof createVisitOperationGroup>
>;
type InvocationCoordinator = ReturnType<typeof createInvocationCoordinator>;

interface HttpNewVisit {
  readonly id?: string;
  readonly itemId: string;
  readonly visitedAt: string;
  readonly rating?: number;
  readonly note?: string;
}

interface HttpVisitUpdate {
  readonly itemId?: string;
  readonly visitedAt: string;
  readonly rating?: number | null;
  readonly note?: string;
}

export async function listVisitsResponse(
  application: VisitApplication,
): Promise<Response> {
  const result = await application.execute({ key: 'visit.list', input: {} });
  return result.ok
    ? Response.json(result.value)
    : new Response('Journal entries are temporarily unavailable.', {
        status: 500,
      });
}

export async function createVisitResponse(
  coordinator: InvocationCoordinator,
  request: Request,
  input: unknown,
): Promise<Response> {
  if (!isHttpNewVisit(input)) {
    return new Response(invalidCreateMessage, { status: 400 });
  }
  return ownerMutationResponse({
    coordinator,
    request,
    operation: 'visit.create',
    operationInput: {
      ...(input.id === undefined ? {} : { id: input.id.trim() }),
      itemId: input.itemId,
      visitedAt: input.visitedAt,
      ...(input.rating === undefined ? {} : { rating: input.rating }),
      ...(input.note === undefined ? {} : { note: input.note }),
    },
    successStatus: 201,
    errors: {
      invalidInput: invalidCreateMessage,
      notFound: 'Atlas item not found',
      dependencyFailure: 'The Journal entry could not be saved.',
    },
  });
}

export async function updateVisitResponse(
  coordinator: InvocationCoordinator,
  request: Request,
  id: string,
  input: unknown,
): Promise<Response> {
  if (!id || !isHttpVisitUpdate(input)) {
    return new Response('Invalid visit update', { status: 400 });
  }
  return ownerMutationResponse({
    coordinator,
    request,
    operation: 'visit.update',
    operationInput: {
      id,
      ...(input.itemId === undefined ? {} : { itemId: input.itemId }),
      visitedAt: input.visitedAt,
      ...(input.note === undefined ? {} : { note: input.note }),
      ...(input.rating === undefined ? {} : { rating: input.rating }),
    },
    errors: {
      invalidInput: 'Invalid visit update',
      notFound: 'Journal entry not found',
      dependencyFailure: 'The Journal entry could not be updated.',
    },
  });
}

function isHttpNewVisit(value: unknown): value is HttpNewVisit {
  if (!isRecord(value)) return false;
  return (
    (value.id === undefined ||
      (typeof value.id === 'string' && Boolean(value.id.trim()))) &&
    typeof value.itemId === 'string' &&
    Boolean(value.itemId) &&
    typeof value.visitedAt === 'string' &&
    Boolean(value.visitedAt) &&
    (value.rating === undefined || isRating(value.rating)) &&
    (value.note === undefined || typeof value.note === 'string')
  );
}

function isHttpVisitUpdate(value: unknown): value is HttpVisitUpdate {
  if (!isRecord(value)) return false;
  return (
    typeof value.visitedAt === 'string' &&
    Boolean(value.visitedAt) &&
    (value.itemId === undefined ||
      (typeof value.itemId === 'string' && Boolean(value.itemId))) &&
    (value.note === undefined || typeof value.note === 'string') &&
    (value.rating === undefined ||
      value.rating === null ||
      isRating(value.rating))
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

const invalidCreateMessage =
  'Valid place and date are required; optional ratings must be between 0 and 5';
