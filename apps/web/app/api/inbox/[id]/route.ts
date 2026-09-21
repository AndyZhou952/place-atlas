import { getServerAtlasApplication } from '@/lib/server/application/server-atlas-application';
import { rejectUncoordinatedOwnerPocWrite } from '@/lib/server/application/owner-poc-write-policy';
import { withOwnerWriteAuth } from '@/lib/server/auth/owner-auth';

import { deleteImportJobResponse } from '../import-job-write-response';

export const dynamic = 'force-dynamic';

export const DELETE = withOwnerWriteAuth(async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const unavailable = rejectUncoordinatedOwnerPocWrite();
  if (unavailable) return unavailable;
  void request;
  const { id } = await context.params;
  return deleteImportJobResponse(getServerAtlasApplication(), id);
});
