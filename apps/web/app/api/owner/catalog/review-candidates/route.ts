import { getServerAtlasApplication } from '../../../../../lib/server/application/server-atlas-application.ts';
import { authorizeOwnerRead } from '../../../../../lib/server/auth/owner-auth.ts';
import { createOwnerReviewCandidateListGet } from './owner-review-candidate-route.ts';

export const dynamic = 'force-dynamic';

export const GET = createOwnerReviewCandidateListGet({
  authorizeOwnerRead,
  getApplication: getServerAtlasApplication,
});
