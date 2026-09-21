import { getServerAtlasApplication } from '@/lib/server/application/server-atlas-application';
import { withOwnerReadAuth } from '@/lib/server/auth/owner-auth';

import { nearbyAtlasItemsResponse } from './nearby-atlas-items-response';

export const dynamic = 'force-dynamic';

export const GET = withOwnerReadAuth(async function GET(request: Request) {
  return nearbyAtlasItemsResponse(
    getServerAtlasApplication(),
    new URL(request.url).searchParams,
  );
});
