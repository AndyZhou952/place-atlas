import { getPreviewGoogleRating } from '@/lib/server/application/google-rating-service';
import {
  getOwnerWebConversationId,
  withOwnerReadAuth,
} from '@/lib/server/auth/owner-auth';

export const dynamic = 'force-dynamic';

export const GET = withOwnerReadAuth(async function GET(request: Request) {
  const conversationId = await getOwnerWebConversationId(request);
  if (!conversationId)
    return new Response('Owner conversation unavailable.', { status: 401 });
  const sessionId = new URL(request.url).searchParams.get('sessionId');
  if (!sessionId || !/^[A-Za-z0-9_-]{10,128}$/u.test(sessionId))
    return new Response('Invalid session.', { status: 400 });
  const result = await getPreviewGoogleRating(sessionId, conversationId);
  if (result.kind === 'not_found')
    return new Response('Preview not found.', { status: 404 });
  if (result.kind === 'unavailable')
    return new Response(null, {
      status: 204,
      headers: { 'Cache-Control': 'private, no-store' },
    });
  return Response.json(result.value, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
});
