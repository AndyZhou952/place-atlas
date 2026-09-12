import { getServerAtlasApplication } from '@/lib/server/application/server-atlas-application';

import {
  deleteVisitMediaResponse,
  updateVisitMediaCaptionResponse,
} from './media-mutation-response';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return updateVisitMediaCaptionResponse(
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
  return deleteVisitMediaResponse(getServerAtlasApplication(), id);
}
