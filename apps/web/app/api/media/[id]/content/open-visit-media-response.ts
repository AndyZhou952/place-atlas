import type { AtlasApplication } from '@/product/application/atlas-application';
import type { createMediaOperationGroup } from '@/product/application/media/media-operations';

type MediaApplication = AtlasApplication<
  ReturnType<typeof createMediaOperationGroup>
>;

export async function openVisitMediaResponse(
  application: MediaApplication,
  id: string,
): Promise<Response> {
  const result = await application.openMedia({
    key: 'media.open',
    input: { id },
  });
  if (!result.ok) {
    const status =
      result.error.kind === 'invalid_input'
        ? 400
        : result.error.kind === 'not_found'
          ? 404
          : 500;
    return new Response(
      status === 404 ? 'Photo not found' : 'Photo content is unavailable',
      { status },
    );
  }

  const headers = new Headers({
    'cache-control': 'private, max-age=3600',
    'content-length': result.value.byteSize.toString(),
    'content-type': result.value.contentType,
  });
  if (result.value.etag) headers.set('etag', result.value.etag);
  return new Response(result.value.body, { headers });
}
