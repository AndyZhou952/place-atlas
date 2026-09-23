import { getServerAtlasApplication } from '@/lib/server/application/server-atlas-application';
import { rejectUncoordinatedOwnerPocWrite } from '@/lib/server/application/owner-poc-write-policy';
import {
  withOwnerReadAuth,
  withOwnerWriteAuth,
} from '@/lib/server/auth/owner-auth';

import { queueImportJobResponse } from './import-job-write-response';
import { listImportJobsResponse } from './list-import-jobs-response';

export const dynamic = 'force-dynamic';

export const GET = withOwnerReadAuth(async function GET(_request: Request) {
  return listImportJobsResponse(getServerAtlasApplication());
});

export const POST = withOwnerWriteAuth(async function POST(request: Request) {
  const unavailable = rejectUncoordinatedOwnerPocWrite();
  if (unavailable) return unavailable;
  return queueImportJobResponse(
    getServerAtlasApplication(),
    await request.json(),
  );
});
