import type { AtlasApplication } from '../../../../../product/application/atlas-application.ts';
import type { createCatalogReadOperationGroup } from '../../../../../product/application/catalog/catalog-operations.ts';
import { isAtlasReviewCandidate } from '../../../../../product/application/catalog/catalog-projection.ts';
import { projectOwnerReviewCandidate } from './owner-review-candidate-projection.ts';

type CatalogApplication = AtlasApplication<
  ReturnType<typeof createCatalogReadOperationGroup>
>;

interface OwnerReviewCandidateRouteDependencies {
  readonly authorizeOwnerRead: (
    request: Request,
  ) => Promise<Response | undefined>;
  readonly getApplication: () => CatalogApplication;
}

export function createOwnerReviewCandidateListGet(
  dependencies: OwnerReviewCandidateRouteDependencies,
) {
  return async function GET(request: Request): Promise<Response> {
    const rejected = await dependencies.authorizeOwnerRead(request);
    if (rejected) return rejected;
    const result = await dependencies.getApplication().execute({
      key: 'catalog.list',
      input: { profile: 'full_merged_catalog' },
    });
    if (!result.ok) {
      return new Response('Owner Catalog is temporarily unavailable.', {
        status: 500,
      });
    }
    return Response.json(
      result.value
        .filter(isAtlasReviewCandidate)
        .map(projectOwnerReviewCandidate),
      { headers: { 'cache-control': 'no-store' } },
    );
  };
}

export function createOwnerReviewCandidateDetailGet(
  dependencies: OwnerReviewCandidateRouteDependencies,
) {
  return async function GET(
    request: Request,
    context: { params: Promise<{ id: string }> },
  ): Promise<Response> {
    const rejected = await dependencies.authorizeOwnerRead(request);
    if (rejected) return rejected;
    const { id } = await context.params;
    const result = await dependencies.getApplication().execute({
      key: 'catalog.get',
      input: { id },
    });
    if (!result.ok || !isAtlasReviewCandidate(result.value)) {
      return new Response('Review Candidate not found', { status: 404 });
    }
    return Response.json(projectOwnerReviewCandidate(result.value), {
      headers: { 'cache-control': 'no-store' },
    });
  };
}
