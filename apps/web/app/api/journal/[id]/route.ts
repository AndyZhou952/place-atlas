import { NextResponse } from 'next/server';

import type { VisitUpdate } from '@/features/atlas/model';
import { normalizeRating } from '@/features/atlas/rating';
import { deleteJournalEntry, updateVisit } from '@/lib/server/atlas-store';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const input = (await request.json()) as Partial<VisitUpdate>;
  if (
    !id ||
    typeof input.visitedAt !== 'string' ||
    !input.visitedAt ||
    (input.note !== undefined && typeof input.note !== 'string') ||
    (input.rating !== undefined &&
      input.rating !== null &&
      (typeof input.rating !== 'number' ||
        !Number.isFinite(input.rating) ||
        input.rating < 0 ||
        input.rating > 5))
  ) {
    return new NextResponse('Invalid visit update', { status: 400 });
  }

  const result = await updateVisit(id, {
    visitedAt: input.visitedAt,
    note: input.note?.trim() || undefined,
    ...(input.rating === undefined
      ? {}
      : {
          rating: input.rating === null ? null : normalizeRating(input.rating),
        }),
  });
  if (!result)
    return new NextResponse('Journal entry not found', { status: 404 });
  return NextResponse.json(result);
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!id)
    return new NextResponse('Journal entry ID is required', { status: 400 });

  const result = await deleteJournalEntry(id);
  if (!result)
    return new NextResponse('Journal entry not found', { status: 404 });
  return NextResponse.json(result);
}
