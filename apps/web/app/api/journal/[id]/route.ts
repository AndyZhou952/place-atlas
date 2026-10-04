import { deleteVisitResponse } from '@/app/api/destructive-responses';
import { getServerAtlasApplication } from '@/lib/server/application/server-atlas-application';
import { getServerInvocationCoordinator } from '@/lib/server/application/server-invocation-coordinator';
import { withOwnerWriteAuth } from '@/lib/server/auth/owner-auth';

import { updateVisitResponse } from '../visit-responses';
import { getDisplayVisitResponse } from '../public-visit-responses';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return getDisplayVisitResponse(getServerAtlasApplication(), id);
}

export const PATCH = withOwnerWriteAuth(async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return updateVisitResponse(
    getServerInvocationCoordinator(),
    request,
    id,
    await request.json(),
  );
});

export const DELETE = withOwnerWriteAuth(async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return deleteVisitResponse(getServerInvocationCoordinator(), request, id);
});
