import type { AtlasApplication } from '@/product/application/atlas-application';
import type { createMediaOperationGroup } from '@/product/application/media/media-operations';
import {
  createPublicReadManifest,
  executePublicMediaRead,
} from '../../../../../lib/server/public-read/public-read-manifest.ts';

type MediaApplication = AtlasApplication<
  ReturnType<typeof createMediaOperationGroup>
>;

export async function openOwnerVisitMediaResponse(
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
      {
        status,
      },
    );
  }
  if (
    !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(
      result.value.contentType,
    )
  ) {
    return new Response('Photo content is unavailable', { status: 415 });
  }

  return new Response(result.value.body, {
    headers: {
      'cache-control': 'private, no-store',
      'content-disposition': 'inline',
      'content-type': result.value.contentType,
      'x-content-type-options': 'nosniff',
    },
  });
}
export async function openVisitMediaResponse(
  application: MediaApplication,
  id: string,
): Promise<Response> {
  const manifest = createPublicReadManifest();
  if (!manifest.authorize('media.openDisplay', { kind: 'anonymous' }).allowed) {
    return new Response('Public resource not found.', { status: 404 });
  }
  const result = await application.openMedia({
    key: 'media.openDisplay',
    input: { displayId: id },
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

  return executePublicMediaRead({
    manifest,
    operation: 'media.openDisplay',
    principal: { kind: 'anonymous' },
    async load() {
      return result.value;
    },
  });
}
