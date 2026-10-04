import { getServerAtlasApplication } from '@/lib/server/application/server-atlas-application';
import { getServerInvocationCoordinator } from '@/lib/server/application/server-invocation-coordinator';
import {
  withOwnerReadAuth,
  withOwnerWriteAuth,
} from '@/lib/server/auth/owner-auth';

import { attachVisitMediaResponse } from './media-write-response';

import { listVisitMediaResponse } from './list-visit-media-response';
export const dynamic = 'force-dynamic';

export const GET = withOwnerReadAuth(async function GET(request: Request) {
  return listVisitMediaResponse(getServerAtlasApplication(), request);
});

export const POST = withOwnerWriteAuth(async function POST(request: Request) {
  return attachVisitMediaResponse(getServerInvocationCoordinator(), request);
});
