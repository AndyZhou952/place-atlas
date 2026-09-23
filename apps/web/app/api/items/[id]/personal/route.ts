import { getServerAtlasApplication } from '@/lib/server/application/server-atlas-application';
import { getServerInvocationCoordinator } from '@/lib/server/application/server-invocation-coordinator';
import { withOwnerWriteAuth } from '@/lib/server/auth/owner-auth';

import { getPlaceAssessmentResponse } from './get-place-assessment-response';
import { updatePlaceAssessmentResponse } from './update-place-assessment-response';

export const dynamic = 'force-dynamic';
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return getPlaceAssessmentResponse(getServerAtlasApplication(), id);
}

export const PATCH = withOwnerWriteAuth(async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return updatePlaceAssessmentResponse(
    getServerInvocationCoordinator(),
    request,
    id,
    await request.json(),
  );
});
