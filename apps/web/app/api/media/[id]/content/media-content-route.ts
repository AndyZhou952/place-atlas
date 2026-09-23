import {
  openOwnerVisitMediaResponse,
  openVisitMediaResponse,
} from './open-visit-media-response.ts';

type MediaApplication = Parameters<typeof openVisitMediaResponse>[0];

interface MediaContentRouteDependencies {
  readonly authorizeOwnerRead: (
    request: Request,
  ) => Promise<Response | undefined>;
  readonly getApplication: () => MediaApplication;
}

export function createMediaContentGet({
  authorizeOwnerRead,
  getApplication,
}: MediaContentRouteDependencies) {
  return async function GET(
    request: Request,
    context: { params: Promise<{ id: string }> },
  ): Promise<Response> {
    const { id } = await context.params;
    if (id.startsWith('pm_')) {
      return openVisitMediaResponse(getApplication(), id);
    }

    const rejected = await authorizeOwnerRead(request);
    if (rejected) return rejected;
    return openOwnerVisitMediaResponse(getApplication(), id);
  };
}
