import type { AtlasApplication } from '@/product/application/atlas-application';
import type { createCatalogReadOperationGroup } from '@/product/application/catalog/catalog-operations';
import {
  createPublicReadManifest,
  executePublicJsonRead,
} from '../../../lib/server/public-read/public-read-manifest.ts';

type CatalogApplication = AtlasApplication<
  ReturnType<typeof createCatalogReadOperationGroup>
>;

export async function listAtlasItemsResponse(
  application: CatalogApplication,
  profile: 'verified_catalog' | 'full_merged_catalog' = 'verified_catalog',
): Promise<Response> {
  return executePublicJsonRead({
    manifest: createPublicReadManifest(),
    operation: 'catalog.list',
    principal: { kind: 'anonymous' },
    async load() {
      const result = await application.execute({
        key: 'catalog.list',
        input: { profile },
      });
      if (!result.ok) throw new Error('catalog unavailable');
      return result.value;
    },
  });
}

export async function listAtlasItemsForRequest(
  request: Request,
  application: CatalogApplication,
  authorizeOwnerRead: (request: Request) => Promise<Response | undefined>,
): Promise<Response> {
  const profile =
    new URL(request.url).searchParams.get('profile') ?? 'verified_catalog';
  if (profile !== 'verified_catalog' && profile !== 'full_merged_catalog')
    return new Response('Invalid catalog profile.', { status: 400 });
  if (profile === 'full_merged_catalog') {
    const rejected = await authorizeOwnerRead(request);
    if (rejected) return rejected;
  }
  return listAtlasItemsResponse(application, profile);
}
