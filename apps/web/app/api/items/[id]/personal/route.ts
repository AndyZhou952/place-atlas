import { getServerAtlasApplication } from '@/lib/server/application/server-atlas-application';

import { updatePlaceAssessmentResponse } from './update-place-assessment-response';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return updatePlaceAssessmentResponse(
    getServerAtlasApplication(),
    id,
    await request.json(),
  );
}
