import { getServerInvocationCoordinator } from '@/lib/server/application/server-invocation-coordinator';
import { withOwnerWriteAuth } from '@/lib/server/auth/owner-auth';

import {
  deleteVisitMediaResponse,
  updateVisitMediaCaptionResponse,
} from './media-mutation-response';

export const dynamic = 'force-dynamic';

export const PATCH = withOwnerWriteAuth(async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return updateVisitMediaCaptionResponse(
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
  return deleteVisitMediaResponse(
    getServerInvocationCoordinator(),
    request,
    id,
  );
});
