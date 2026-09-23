import { getServerAtlasApplication } from '../../../../../../lib/server/application/server-atlas-application.ts';
import { authorizeOwnerRead } from '../../../../../../lib/server/auth/owner-auth.ts';
import { createOwnerReviewCandidateDetailGet } from '../owner-review-candidate-route.ts';

export const dynamic = 'force-dynamic';

export const GET = createOwnerReviewCandidateDetailGet({
  authorizeOwnerRead,
  getApplication: getServerAtlasApplication,
});
