import { NextResponse } from 'next/server';

import type { NewImportJob } from '@/features/atlas/model';
import { listImportJobs, queueImportJob } from '@/lib/server/atlas-store';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(await listImportJobs());
}

export async function POST(request: Request) {
  const input = (await request.json()) as Partial<NewImportJob>;
  if (
    typeof input.sourceRef !== 'string' ||
    !input.sourceRef.trim() ||
    typeof input.creatorName !== 'string' ||
    !input.creatorName.trim()
  ) {
    return new NextResponse('Creator name and source reference are required', {
      status: 400,
    });
  }

  return NextResponse.json(
    await queueImportJob({
      sourceRef: input.sourceRef.trim(),
      creatorName: input.creatorName.trim(),
      platform: input.platform,
    }),
    { status: 201 },
  );
}
