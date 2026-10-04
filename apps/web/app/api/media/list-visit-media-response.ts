import type { AtlasApplication } from '@/product/application/atlas-application';
import type { createMediaOperationGroup } from '@/product/application/media/media-operations';

type MediaApplication = AtlasApplication<
  ReturnType<typeof createMediaOperationGroup>
>;

export async function listVisitMediaResponse(
  application: MediaApplication,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const result = await application.execute({
    key: 'media.list',
    input: {
      visitId: url.searchParams.get('visitId') || undefined,
      itemId: url.searchParams.get('itemId') || undefined,
    },
  });
  if (!result.ok) {
    return new Response('Visit photos are temporarily unavailable.', {
      status: result.error.kind === 'invalid_input' ? 400 : 500,
    });
  }
  return Response.json(result.value);
}
