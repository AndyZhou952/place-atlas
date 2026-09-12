import { getServerAtlasApplication } from '@/lib/server/application/server-atlas-application';

import { deleteImportJobResponse } from '../import-job-write-response';

export const dynamic = 'force-dynamic';

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return deleteImportJobResponse(getServerAtlasApplication(), id);
}
