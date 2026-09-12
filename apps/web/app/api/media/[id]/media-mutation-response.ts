import type { AtlasApplication } from '@/product/application/atlas-application';
import type { createMediaOperationGroup } from '@/product/application/media/media-operations';

type MediaApplication = AtlasApplication<
  ReturnType<typeof createMediaOperationGroup>
>;

export async function updateVisitMediaCaptionResponse(
  application: MediaApplication,
  id: string,
  input: unknown,
): Promise<Response> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return new Response('Caption must be text.', { status: 400 });
  }
  const caption = Reflect.get(input, 'caption');
  if (
    caption !== undefined &&
    caption !== null &&
    typeof caption !== 'string'
  ) {
    return new Response('Caption must be text.', { status: 400 });
  }
  const result = await application.execute({
    key: 'media.caption',
    input: { id, caption },
  });
  if (result.ok) return Response.json(result.value);
  if (result.error.kind === 'invalid_input') {
    return new Response(result.error.message, { status: 400 });
  }
  if (result.error.kind === 'not_found') {
    return new Response('Photo not found', { status: 404 });
  }
  return new Response('The photo caption could not be updated.', {
    status: 400,
  });
}

export async function deleteVisitMediaResponse(
  application: MediaApplication,
  id: string,
): Promise<Response> {
  const result = await application.execute({
    key: 'media.delete',
    input: { id },
  });
  if (result.ok) return Response.json(result.value);
  if (result.error.kind === 'invalid_input') {
    return new Response('Photo ID is required', { status: 400 });
  }
  if (result.error.kind === 'not_found') {
    return new Response('Photo not found', { status: 404 });
  }
  return new Response('The photo could not be deleted.', { status: 500 });
}
