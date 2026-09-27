import { ownerMutationResponse } from '../owner-mutation-response.ts';
import type { createInvocationCoordinator } from '../../../product/application/invocation/invocation-coordinator.ts';

import {
  maxMediaFilesPerRequest,
  maxMediaFileBytes,
  maxVideoFileBytes,
} from '../../../features/atlas/media-constraints.ts';

type InvocationCoordinator = ReturnType<typeof createInvocationCoordinator>;

export async function attachVisitMediaResponse(
  coordinator: InvocationCoordinator,
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
  const ids = form
    .getAll('ids')
    .map((value) => (typeof value === 'string' ? value : ''));
  if (typeof visitId !== 'string' || !visitId || !files.length) {
    return new Response(
      'A Visit and at least one photo or video are required.',
      {
        status: 400,
      },
    );
  }
  if (
    ids.length !== files.length ||
    ids.some((id) => !/^[A-Za-z0-9._:-]{1,160}$/u.test(id))
  ) {
    return new Response('A stable ID is required for every media file.', {
      status: 400,
    });
  }
  if (files.length > maxMediaFilesPerRequest) {
    return new Response(
      `Upload no more than ${maxMediaFilesPerRequest} files in one request.`,
      { status: 400 },
    );
  }
  if (
    files.some(
      (file) =>
        file.size >
        (file.type.startsWith('video/')
          ? maxVideoFileBytes
          : maxMediaFileBytes),
    )
  ) {
    return new Response('A photo exceeds 8 MB or a video exceeds 50 MB.', {
      status: 400,
    });
  }

  return ownerMutationResponse({
    coordinator,
    request,
    operation: 'media.attach',
    operationInput: {
      visitId,
      uploads: await Promise.all(
        files.map(async (file, index) => ({
          id: ids[index],
          originalFilename: file.name,
          contentType: file.type,
          bytes: new Uint8Array(await file.arrayBuffer()),
          caption: captions[index],
        })),
      ),
    },
    successStatus: 201,
    errors: {
      invalidInput: 'Visit photos could not be saved.',
      notFound: 'Journal entry not found',
      dependencyFailure: 'Visit photos could not be saved.',
    },
  });
}
