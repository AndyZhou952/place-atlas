import { NextResponse } from 'next/server';

import { createAgentCapabilitiesDocument } from '@/features/atlas/atlas-browser-operation-catalog';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json(createAgentCapabilitiesDocument());
}
