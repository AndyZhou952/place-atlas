import { NextResponse } from 'next/server';

import { deleteImportJob } from '@/lib/server/atlas-store';

export const dynamic = 'force-dynamic';

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (!id)
    return new NextResponse('Import job ID is required', { status: 400 });

  const deleted = await deleteImportJob(id);
  if (!deleted)
    return new NextResponse('Import job not found', { status: 404 });
  return NextResponse.json({ id, deleted: true });
}
