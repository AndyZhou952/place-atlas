import { getServerInvocationCoordinator } from '@/lib/server/application/server-invocation-coordinator';
import { withOwnerWriteAuth } from '@/lib/server/auth/owner-auth';

import {
  deleteVisitMediaResponse,
  updateVisitMediaCaptionResponse,
  updateVisitMediaScoreResponse,
} from './media-mutation-response';

export const dynamic = 'force-dynamic';

export const PATCH = withOwnerWriteAuth(async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const input = await request.json();
  if (
    input &&
    typeof input === 'object' &&
    Object.prototype.hasOwnProperty.call(input, 'score')
  ) {
    return updateVisitMediaScoreResponse(
      getServerInvocationCoordinator(),
      request,
      id,
      input,
    );
  }
  return updateVisitMediaCaptionResponse(
    getServerInvocationCoordinator(),
    request,
    id,
    input,
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
