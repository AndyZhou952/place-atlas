import { getServerAtlasApplication } from '@/lib/server/application/server-atlas-application';

import { createVisitResponse, listVisitsResponse } from './visit-responses';

export const dynamic = 'force-dynamic';

export async function GET() {
  return listVisitsResponse(getServerAtlasApplication());
}

export async function POST(request: Request) {
  return createVisitResponse(getServerAtlasApplication(), await request.json());
}
