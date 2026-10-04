import { getServerAtlasApplication } from '@/lib/server/application/server-atlas-application';
import { authorizeOwnerRead } from '@/lib/server/auth/owner-auth';

import { createMediaContentGet } from './media-content-route';

export const dynamic = 'force-dynamic';

export const GET = createMediaContentGet({
  authorizeOwnerRead,
  getApplication: getServerAtlasApplication,
});
