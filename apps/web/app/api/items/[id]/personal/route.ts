import { NextResponse } from 'next/server';

import type { PlaceAssessmentPatch } from '@/features/atlas/model';
import { normalizeRating } from '@/features/atlas/rating';
import { updatePlaceAssessment } from '@/lib/server/atlas-store';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const input = (await request.json()) as PlaceAssessmentPatch;
  if (
    (input.isFavorite !== undefined && typeof input.isFavorite !== 'boolean') ||
    (input.hasVisited !== undefined && typeof input.hasVisited !== 'boolean') ||
    (input.overallRating !== undefined &&
      input.overallRating !== null &&
      (typeof input.overallRating !== 'number' ||
        !Number.isFinite(input.overallRating) ||
        input.overallRating < 0 ||
        input.overallRating > 5)) ||
    (input.summary !== undefined &&
      input.summary !== null &&
      typeof input.summary !== 'string')
  ) {
    return new NextResponse('Invalid personal item update', { status: 400 });
  }

  try {
    return NextResponse.json(
      await updatePlaceAssessment(id, {
        ...input,
        ...(typeof input.overallRating === 'number'
          ? { overallRating: normalizeRating(input.overallRating) }
          : {}),
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'Atlas item not found') {
      return new NextResponse(error.message, { status: 404 });
    }
    throw error;
  }
}
