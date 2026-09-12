import { getServerAtlasApplication } from '@/lib/server/application/server-atlas-application';

import { openVisitMediaResponse } from './open-visit-media-response';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return openVisitMediaResponse(getServerAtlasApplication(), id);
}
