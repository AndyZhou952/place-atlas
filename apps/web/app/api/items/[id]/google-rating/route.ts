import { getSavedPlaceGoogleRating } from '@/lib/server/application/google-rating-service';
import { withOwnerReadAuth } from '@/lib/server/auth/owner-auth';

export const dynamic = 'force-dynamic';

export const GET = withOwnerReadAuth(async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const result = await getSavedPlaceGoogleRating(id);
  if (result.kind === 'not_found')
    return new Response('Place not found.', { status: 404 });
  if (result.kind === 'unavailable') return new Response(null, { status: 204 });
  return Response.json(result.value, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
});
