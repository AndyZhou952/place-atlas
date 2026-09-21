import type { AtlasApplication } from '@/product/application/atlas-application';
import type { createPublicDisplayOperationGroup } from '@/product/application/public-display/public-display-operations';
import {
  createPublicReadManifest,
  executePublicJsonRead,
} from '../../../../../lib/server/public-read/public-read-manifest.ts';

type DisplayApplication = AtlasApplication<
  ReturnType<typeof createPublicDisplayOperationGroup>
>;

export function getPlaceAssessmentResponse(
  application: DisplayApplication,
  itemId: string,
): Promise<Response> {
  return executePublicJsonRead({
    manifest: createPublicReadManifest(),
    operation: 'assessment.display',
    principal: { kind: 'anonymous' },
    async load() {
      const result = await application.execute({
        key: 'assessment.display',
        input: { itemId },
      });
      if (!result.ok) throw new Error('assessment unavailable');
      return result.value;
    },
  });
}
