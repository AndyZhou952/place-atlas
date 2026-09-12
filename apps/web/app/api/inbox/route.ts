import { getServerAtlasApplication } from '@/lib/server/application/server-atlas-application';

import { queueImportJobResponse } from './import-job-write-response';
import { listImportJobsResponse } from './list-import-jobs-response';

export const dynamic = 'force-dynamic';

export async function GET() {
  return listImportJobsResponse(getServerAtlasApplication());
}

export async function POST(request: Request) {
  return queueImportJobResponse(
    getServerAtlasApplication(),
    await request.json(),
  );
}
