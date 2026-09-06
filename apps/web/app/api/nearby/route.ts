import { NextRequest, NextResponse } from 'next/server';

import { distanceInKm } from '@/features/atlas/distance';
import { listAtlasItems } from '@/lib/server/atlas-store';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const latitude = Number(request.nextUrl.searchParams.get('lat'));
  const longitude = Number(request.nextUrl.searchParams.get('lon'));
  const requestedLimit = Number(request.nextUrl.searchParams.get('limit') ?? 5);
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return new NextResponse('Valid lat and lon query parameters are required', {
      status: 400,
    });
  }

  const limit = Math.min(Math.max(Math.floor(requestedLimit) || 5, 1), 20);
  const results = (await listAtlasItems())
    .filter((item) => item.verificationStatus === 'verified')
    .map((item) => ({
      id: item.id,
      title: item.title,
      kind: item.kind,
      area: item.area,
      distanceKm: distanceInKm(
        latitude,
        longitude,
        item.latitude,
        item.longitude,
      ),
      tabelogScore: item.tabelog?.score,
      reservation: item.reservation,
    }))
    .sort((left, right) => left.distanceKm - right.distanceKm)
    .slice(0, limit);

  return NextResponse.json(results);
}
