import type { AtlasApplication } from '@/product/application/atlas-application';
import type { createPublicDisplayOperationGroup } from '@/product/application/public-display/public-display-operations';
import {
  createPublicReadManifest,
  executePublicJsonRead,
} from '../../../lib/server/public-read/public-read-manifest.ts';

type DisplayApplication = AtlasApplication<
  ReturnType<typeof createPublicDisplayOperationGroup>
>;

export function listDisplayVisitsResponse(
  application: DisplayApplication,
): Promise<Response> {
  return executePublicJsonRead({
    manifest: createPublicReadManifest(),
    operation: 'visit.listDisplay',
    principal: { kind: 'anonymous' },
    async load() {
      const result = await application.execute({
        key: 'visit.listDisplay',
        input: {},
      });
      if (!result.ok) throw new Error('visits unavailable');
      return result.value;
    },
  });
}

export async function getDisplayVisitResponse(
  application: DisplayApplication,
  id: string,
): Promise<Response> {
  const result = await application.execute({
    key: 'visit.getDisplay',
    input: { id },
  });
  if (!result.ok && result.error.kind === 'not_found') {
    return new Response('Public resource not found.', { status: 404 });
  }
  return executePublicJsonRead({
    manifest: createPublicReadManifest(),
    operation: 'visit.getDisplay',
    principal: { kind: 'anonymous' },
    async load() {
      if (!result.ok) throw new Error('visit unavailable');
      return result.value;
    },
  });
}
