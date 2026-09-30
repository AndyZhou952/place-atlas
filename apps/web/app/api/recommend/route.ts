import { getServerRecommendService } from '@/lib/server/application/server-recommend-service';
import { withOwnerWriteAuth } from '@/lib/server/auth/owner-auth';

import { recommendResponse } from './recommend-response';

export const dynamic = 'force-dynamic';

export const POST = withOwnerWriteAuth(async function POST(request: Request) {
  return recommendResponse(request, getServerRecommendService());
});
