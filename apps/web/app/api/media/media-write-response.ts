import type { AtlasApplication } from '@/product/application/atlas-application';
import type { createMediaOperationGroup } from '@/product/application/media/media-operations';

import { maxMediaFilesPerRequest } from '../../../features/atlas/media-constraints.ts';

type MediaApplication = AtlasApplication<
  ReturnType<typeof createMediaOperationGroup>
>;

export async function attachVisitMediaResponse(
  application: MediaApplication,
  request: Request,
): Promise<Response> {
  const form = await request.formData();
  const visitId = form.get('visitId');
  const files = form
    .getAll('files')
    .filter((value): value is File => value instanceof File);
  const captions = form
    .getAll('captions')
    .map((value) => (typeof value === 'string' ? value : ''));
  if (typeof visitId !== 'string' || !visitId || !files.length) {
    return new Response('A Visit and at least one image are required.', {
      status: 400,
    });
  }
  if (files.length > maxMediaFilesPerRequest) {
    return new Response(
      `Upload no more than ${maxMediaFilesPerRequest} images in one request.`,
      { status: 400 },
    );
  }

  const result = await application.execute({
    key: 'media.attach',
    input: {
      visitId,
      uploads: await Promise.all(
        files.map(async (file, index) => ({
          originalFilename: file.name,
          contentType: file.type,
          bytes: new Uint8Array(await file.arrayBuffer()),
          caption: captions[index],
        })),
      ),
    },
  });
  if (result.ok) return Response.json(result.value, { status: 201 });
  if (result.error.kind === 'invalid_input') {
    return new Response(result.error.message, { status: 400 });
  }
  if (result.error.kind === 'not_found') {
    return new Response('Journal entry not found', { status: 404 });
  }
  return new Response('Visit photos could not be saved.', { status: 500 });
}
