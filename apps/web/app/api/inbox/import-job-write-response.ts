import type { AtlasApplication } from '@/product/application/atlas-application';
import type { NewImportJob } from '@/product/application/import-jobs/import-job';
import type { createImportJobOperationGroup } from '@/product/application/import-jobs/import-job-operations';

type ImportJobApplication = AtlasApplication<
  ReturnType<typeof createImportJobOperationGroup>
>;

export async function queueImportJobResponse(
  application: ImportJobApplication,
  input: unknown,
): Promise<Response> {
  const parsed = parseNewImportJob(input);
  if (!parsed) {
    return new Response('Creator name and source reference are required', {
      status: 400,
    });
  }

  const result = await application.execute({
    key: 'import.queue',
    input: parsed,
  });
  if (result.ok) return Response.json(result.value, { status: 201 });

  if (result.error.kind === 'invalid_input') {
    return new Response('Creator name and source reference are required', {
      status: 400,
    });
  }
  return new Response('The import job could not be queued.', { status: 500 });
}

export async function deleteImportJobResponse(
  application: ImportJobApplication,
  id: string,
): Promise<Response> {
  const result = await application.execute({
    key: 'import.delete',
    input: { id },
  });
  if (result.ok) return Response.json(result.value);

  if (result.error.kind === 'invalid_input') {
    return new Response('Import job ID is required', { status: 400 });
  }
  if (result.error.kind === 'not_found') {
    return new Response('Import job not found', { status: 404 });
  }
  return new Response('The import job could not be deleted.', { status: 500 });
}

function parseNewImportJob(input: unknown): NewImportJob | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const candidate = input as Partial<NewImportJob>;
  if (
    typeof candidate.sourceRef !== 'string' ||
    !candidate.sourceRef.trim() ||
    typeof candidate.creatorName !== 'string' ||
    !candidate.creatorName.trim() ||
    (candidate.platform !== undefined && typeof candidate.platform !== 'string')
  ) {
    return null;
  }
  return {
    sourceRef: candidate.sourceRef,
    creatorName: candidate.creatorName,
    platform: candidate.platform,
  };
}
