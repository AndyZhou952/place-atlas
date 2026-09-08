import { NextResponse } from 'next/server';

import { maxMediaFilesPerRequest } from '@/features/atlas/media-constraints';
import { attachVisitMedia, listVisitMedia } from '@/lib/server/media-store';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  return NextResponse.json(
    await listVisitMedia({
      visitId: url.searchParams.get('visitId') || undefined,
      itemId: url.searchParams.get('itemId') || undefined,
    }),
  );
}

export async function POST(request: Request) {
  const form = await request.formData();
  const visitId = form.get('visitId');
  const files = form
    .getAll('files')
    .filter((value): value is File => value instanceof File);
  const captions = form
    .getAll('captions')
    .map((value) => (typeof value === 'string' ? value : ''));
  if (typeof visitId !== 'string' || !visitId || !files.length) {
    return new NextResponse('A Visit and at least one image are required.', {
      status: 400,
    });
  }
  if (files.length > maxMediaFilesPerRequest) {
    return new NextResponse(
      `Upload no more than ${maxMediaFilesPerRequest} images in one request.`,
      { status: 400 },
    );
  }

  try {
    const media = await attachVisitMedia(
      visitId,
      await Promise.all(
        files.map(async (file, index) => ({
          originalFilename: file.name,
          contentType: file.type,
          bytes: new Uint8Array(await file.arrayBuffer()),
          caption: captions[index],
        })),
      ),
    );
    return NextResponse.json(media, { status: 201 });
  } catch (error) {
    if (error instanceof TypeError) {
      return new NextResponse(error.message, { status: 400 });
    }
    if (error instanceof Error && error.message === 'Journal entry not found') {
      return new NextResponse(error.message, { status: 404 });
    }
    throw error;
  }
}
