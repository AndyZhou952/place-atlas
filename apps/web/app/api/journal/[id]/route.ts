import { deleteVisitResponse } from '@/app/api/destructive-responses';
import { getServerAtlasApplication } from '@/lib/server/application/server-atlas-application';

import { updateVisitResponse } from '../visit-responses';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return updateVisitResponse(
    getServerAtlasApplication(),
    id,
    await request.json(),
  );
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return deleteVisitResponse(getServerAtlasApplication(), id);
}
