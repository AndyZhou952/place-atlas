import { NextResponse } from 'next/server';

import { attachVisitMedia, listVisitMedia } from '@/lib/server/media-store';
import { maxMediaFilesPerUpload } from '@/lib/server/media-policy';

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
  if (typeof visitId !== 'string' || !visitId || !files.length) {
    return new NextResponse('A Visit and at least one image are required.', {
      status: 400,
    });
  }
  if (files.length > maxMediaFilesPerUpload) {
    return new NextResponse(
      `Upload no more than ${maxMediaFilesPerUpload} images at once.`,
      { status: 400 },
    );
  }

  try {
    const media = await attachVisitMedia(
      visitId,
      await Promise.all(
        files.map(async (file) => ({
          originalFilename: file.name,
          contentType: file.type,
          bytes: new Uint8Array(await file.arrayBuffer()),
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
