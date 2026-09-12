import { NextRequest } from 'next/server';

import { getServerAtlasApplication } from '@/lib/server/application/server-atlas-application';

import { nearbyAtlasItemsResponse } from './nearby-atlas-items-response';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  return nearbyAtlasItemsResponse(
    getServerAtlasApplication(),
    request.nextUrl.searchParams,
  );
}
