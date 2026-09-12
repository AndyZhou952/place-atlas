import { getServerAtlasApplication } from '@/lib/server/application/server-atlas-application';
import { isAtlasItem } from '@/product/application/catalog/catalog-projection';

import { saveDiscoveredItemResponse } from './item-write-response';
import { listAtlasItemsResponse } from './list-atlas-items-response';

export const dynamic = 'force-dynamic';

export async function GET() {
  return listAtlasItemsResponse(getServerAtlasApplication());
}

export async function POST(request: Request) {
  const item: unknown = await request.json();
  if (
    !isRecord(item) ||
    !item.id ||
    !item.title ||
    !item.kind ||
    !item.description
  ) {
    return new Response('id, title, kind, and description are required', {
      status: 400,
    });
  }
  if (item.verificationStatus !== 'needs_review') {
    return new Response('Collector-created items must enter as needs_review', {
      status: 400,
    });
  }
  if (!isAtlasItem(item)) {
    return new Response('id, title, kind, and description are required', {
      status: 400,
    });
  }

  return saveDiscoveredItemResponse(getServerAtlasApplication(), item);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
