import { getServerAtlasApplication } from '@/lib/server/application/server-atlas-application';
import { getServerInvocationCoordinator } from '@/lib/server/application/server-invocation-coordinator';
import { withOwnerWriteAuth } from '@/lib/server/auth/owner-auth';

import { createVisitResponse } from './visit-responses';
import { listDisplayVisitsResponse } from './public-visit-responses';

export const dynamic = 'force-dynamic';

export async function GET() {
  return listDisplayVisitsResponse(getServerAtlasApplication());
}

export const POST = withOwnerWriteAuth(async function POST(request: Request) {
  return createVisitResponse(
    getServerInvocationCoordinator(),
    request,
    await request.json(),
  );
});
