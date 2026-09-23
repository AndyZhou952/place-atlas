import type { AtlasApplication } from '@/product/application/atlas-application';
import type { createCatalogReadOperationGroup } from '@/product/application/catalog/catalog-operations';
import { createPublicReadManifest } from '../../../../lib/server/public-read/public-read-manifest.ts';
import { isAtlasItem } from '../../../../product/application/catalog/catalog-projection.ts';

type CatalogApplication = AtlasApplication<
  ReturnType<typeof createCatalogReadOperationGroup>
>;

export async function getAtlasItemResponse(
  application: CatalogApplication,
  id: string,
): Promise<Response> {
  const manifest = createPublicReadManifest();
  if (!manifest.authorize('catalog.get', { kind: 'anonymous' }).allowed) {
    return new Response('Public resource not found.', { status: 404 });
  }

  const result = await application.execute({
    key: 'catalog.get',
    input: { id },
  });
  if (!result.ok || !isAtlasItem(result.value)) {
    const status = result.ok
      ? 404
      : result.error.kind === 'invalid_input'
        ? 400
        : result.error.kind === 'not_found'
          ? 404
          : 500;
    return new Response(
      status === 404
        ? 'Atlas item not found'
        : status === 400
          ? 'An Atlas item ID is required'
          : 'Atlas items are temporarily unavailable.',
      { status },
    );
  }
  return Response.json(manifest.project('catalog.get', result.value), {
    headers: { 'cache-control': 'no-store' },
  });
}
