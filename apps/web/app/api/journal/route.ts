import { NextResponse } from 'next/server';

import type { NewVisit } from '@/features/atlas/model';
import { normalizeRating } from '@/features/atlas/rating';
import { addVisit, listVisits } from '@/lib/server/atlas-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(await listVisits());
}

export async function POST(request: Request) {
  const input = (await request.json()) as Partial<NewVisit>;
  if (
    (input.id !== undefined &&
      (typeof input.id !== 'string' || !input.id.trim())) ||
    typeof input.itemId !== 'string' ||
    !input.itemId ||
    typeof input.visitedAt !== 'string' ||
    !input.visitedAt ||
    (input.rating === undefined && !input.note?.trim()) ||
    (input.rating !== undefined &&
      (typeof input.rating !== 'number' ||
        !Number.isFinite(input.rating) ||
        input.rating < 0 ||
        input.rating > 5)) ||
    (input.note !== undefined && typeof input.note !== 'string')
  ) {
    return new NextResponse(
      'Valid place and date are required; add at least a rating or note, and keep ratings between 0 and 5',
      {
        status: 400,
      },
    );
  }

  try {
    return NextResponse.json(
      await addVisit({
        id: input.id?.trim(),
        itemId: input.itemId,
        visitedAt: input.visitedAt,
        rating:
          input.rating === undefined
            ? undefined
            : normalizeRating(input.rating),
        note: input.note?.trim() || undefined,
      }),
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'Atlas item not found') {
      return new NextResponse(error.message, { status: 404 });
    }
    throw error;
  }
}
