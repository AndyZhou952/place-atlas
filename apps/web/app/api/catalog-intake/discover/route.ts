import { getServerAtlasApplication } from '@/lib/server/application/server-atlas-application';
import {
  getOwnerWebConversationId,
  withOwnerWriteAuth,
} from '@/lib/server/auth/owner-auth';

import { catalogIntakeResponse } from '../catalog-intake-response';

export const dynamic = 'force-dynamic';

export const POST = withOwnerWriteAuth(async function POST(request: Request) {
  const serverConversationId = await getOwnerWebConversationId(request);
  return catalogIntakeResponse({
    application: getServerAtlasApplication(),
    request,
    operation: 'catalog.intake.discover',
    serverConversationId,
  });
});
