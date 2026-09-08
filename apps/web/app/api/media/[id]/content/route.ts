import { getVisitMediaObject } from '@/lib/server/media-store';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const result = await getVisitMediaObject(id);
  if (!result) return new Response('Photo not found', { status: 404 });
  return new Response(result.object.body, {
    headers: {
      'cache-control': 'private, max-age=3600',
      'content-length': result.record.byteSize.toString(),
      'content-type': result.record.contentType,
      etag: result.object.httpEtag,
    },
  });
}
