import { NextResponse } from 'next/server';

import {
  deleteVisitMedia,
  updateVisitMediaCaption,
} from '@/lib/server/media-store';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const input = (await request.json()) as { caption?: unknown };
  try {
    const media = await updateVisitMediaCaption(id, input.caption);
    return media
      ? NextResponse.json(media)
      : new NextResponse('Photo not found', { status: 404 });
  } catch (error) {
    return new NextResponse(
      error instanceof Error ? error.message : 'Invalid caption',
      { status: 400 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return (await deleteVisitMedia(id))
    ? NextResponse.json({ id, deleted: true })
    : new NextResponse('Photo not found', { status: 404 });
}
