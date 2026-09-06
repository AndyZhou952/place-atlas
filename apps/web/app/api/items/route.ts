import { NextResponse } from 'next/server';

import type { AtlasItem } from '@/features/atlas/model';
import { listAtlasItems, saveDiscoveredItem } from '@/lib/server/atlas-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(await listAtlasItems());
}

export async function POST(request: Request) {
  const item = (await request.json()) as Partial<AtlasItem>;
  if (!item.id || !item.title || !item.kind || !item.description) {
    return new NextResponse('id, title, kind, and description are required', {
      status: 400,
    });
  }
  if (item.verificationStatus !== 'needs_review') {
    return new NextResponse(
      'Collector-created items must enter as needs_review',
      { status: 400 },
    );
  }

  return NextResponse.json(await saveDiscoveredItem(item as AtlasItem), {
    status: 201,
  });
}
