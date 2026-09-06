import { NextResponse } from 'next/server';

import type { AtlasItemEdit, PersonalState } from '@/features/atlas/model';
import { deleteAtlasItem, updateAtlasItem } from '@/lib/server/atlas-store';

export const dynamic = 'force-dynamic';

const personalStates = new Set<PersonalState>([
  'candidate',
  'saved',
  'planned',
  'visited',
]);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const input = (await request.json()) as Partial<AtlasItemEdit>;
  if (
    typeof input.title !== 'string' ||
    !input.title.trim() ||
    typeof input.description !== 'string' ||
    !input.description.trim() ||
    !input.personalState ||
    !personalStates.has(input.personalState)
  ) {
    return new NextResponse(
      'Valid title, description, and state are required',
      {
        status: 400,
      },
    );
  }

  try {
    return NextResponse.json(
      await updateAtlasItem(id, {
        title: input.title.trim(),
        description: input.description.trim(),
        personalState: input.personalState,
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'Atlas item not found') {
      return new NextResponse(error.message, { status: 404 });
    }
    throw error;
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const deleted = await deleteAtlasItem(id);
  if (!deleted)
    return new NextResponse('Atlas item not found', { status: 404 });
  return NextResponse.json({ id, deleted: true });
}
