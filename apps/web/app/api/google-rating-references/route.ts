import { withOwnerReadAuth } from '@/lib/server/auth/owner-auth';
import { getServerAtlasApplication } from '@/lib/server/application/server-atlas-application';
export const dynamic = 'force-dynamic';
export const GET = withOwnerReadAuth(async function GET() {
  const result = await getServerAtlasApplication().execute({
    key: 'catalog.google_rating_references',
    input: {},
  });
  return result.ok
    ? Response.json(result.value, {
        headers: { 'Cache-Control': 'private, no-store' },
      })
    : new Response('Saved Google references are unavailable.', { status: 503 });
});
