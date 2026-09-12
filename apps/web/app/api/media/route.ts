import { getServerAtlasApplication } from '@/lib/server/application/server-atlas-application';

import { listVisitMediaResponse } from './list-visit-media-response';
import { attachVisitMediaResponse } from './media-write-response';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return listVisitMediaResponse(getServerAtlasApplication(), request);
}

export async function POST(request: Request) {
  return attachVisitMediaResponse(getServerAtlasApplication(), request);
}
