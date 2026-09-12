import type { AtlasApplication } from '@/product/application/atlas-application';
import type { createImportJobOperationGroup } from '@/product/application/import-jobs/import-job-operations';

type ImportJobApplication = AtlasApplication<
  ReturnType<typeof createImportJobOperationGroup>
>;

export async function listImportJobsResponse(
  application: ImportJobApplication,
): Promise<Response> {
  const result = await application.execute({ key: 'import.list', input: {} });
  if (!result.ok) {
    return new Response('Import jobs are temporarily unavailable.', {
      status: 500,
    });
  }
  return Response.json(result.value);
}
