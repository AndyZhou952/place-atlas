import type { AtlasApplication } from '@/product/application/atlas-application';
import type { createPublicDisplayOperationGroup } from '@/product/application/public-display/public-display-operations';
import {
  createPublicReadManifest,
  executePublicJsonRead,
} from '../../../../../lib/server/public-read/public-read-manifest.ts';

type DisplayApplication = AtlasApplication<
  ReturnType<typeof createPublicDisplayOperationGroup>
>;

export async function getPlaceAssessmentResponse(
  application: DisplayApplication,
  itemId: string,
): Promise<Response> {
  const result = await application.execute({
    key: 'assessment.display',
    input: { itemId },
  });
  if (!result.ok && result.error.kind === 'not_found') {
    return new Response('Public resource not found.', { status: 404 });
  }
  return executePublicJsonRead({
    manifest: createPublicReadManifest(),
    operation: 'assessment.display',
    principal: { kind: 'anonymous' },
    async load() {
      if (!result.ok) throw new Error('assessment unavailable');
      return result.value;
    },
  });
}
