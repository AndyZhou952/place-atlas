import type { AtlasApplication } from '@/product/application/atlas-application';
import type { createVisitOperationGroup } from '@/product/application/visits/visit-operations';

type VisitApplication = AtlasApplication<
  ReturnType<typeof createVisitOperationGroup>
>;

interface HttpNewVisit {
  readonly id?: string;
  readonly itemId: string;
  readonly visitedAt: string;
  readonly rating?: number;
  readonly note?: string;
}

interface HttpVisitUpdate {
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
  application: VisitApplication,
  input: unknown,
): Promise<Response> {
  if (!isHttpNewVisit(input)) {
    return new Response(invalidCreateMessage, { status: 400 });
  }
  const result = await application.execute({
    key: 'visit.create',
    input: {
      ...(input.id === undefined ? {} : { id: input.id.trim() }),
      itemId: input.itemId,
      visitedAt: input.visitedAt,
      ...(input.rating === undefined ? {} : { rating: input.rating }),
      ...(input.note === undefined ? {} : { note: input.note }),
    },
  });
  if (result.ok) return Response.json(result.value, { status: 201 });
  if (result.error.kind === 'invalid_input') {
    return new Response(invalidCreateMessage, { status: 400 });
  }
  if (result.error.kind === 'not_found') {
    return new Response('Atlas item not found', { status: 404 });
  }
  return new Response('The Journal entry could not be saved.', {
    status: 500,
  });
}

export async function updateVisitResponse(
  application: VisitApplication,
  id: string,
  input: unknown,
): Promise<Response> {
  if (!id || !isHttpVisitUpdate(input)) {
    return new Response('Invalid visit update', { status: 400 });
  }
  const result = await application.execute({
    key: 'visit.update',
    input: {
      id,
      visitedAt: input.visitedAt,
      ...(input.note === undefined ? {} : { note: input.note }),
      ...(input.rating === undefined ? {} : { rating: input.rating }),
    },
  });
  if (result.ok) return Response.json(result.value);
  if (result.error.kind === 'invalid_input') {
    return new Response('Invalid visit update', { status: 400 });
  }
  if (result.error.kind === 'not_found') {
    return new Response('Journal entry not found', { status: 404 });
  }
  return new Response('The Journal entry could not be updated.', {
    status: 500,
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
    (value.rating !== undefined ||
      (typeof value.note === 'string' && Boolean(value.note.trim()))) &&
    (value.rating === undefined || isRating(value.rating)) &&
    (value.note === undefined || typeof value.note === 'string')
  );
}

function isHttpVisitUpdate(value: unknown): value is HttpVisitUpdate {
  if (!isRecord(value)) return false;
  return (
    typeof value.visitedAt === 'string' &&
    Boolean(value.visitedAt) &&
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
  'Valid place and date are required; add at least a rating or note, and keep ratings between 0 and 5';
