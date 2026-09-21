import type { AtlasItem, VisitMediaRecord, VisitRecord } from './model';

interface ReadTransport {
  request(url: string, init?: RequestInit): Promise<Response>;
}

interface PublicAssessment {
  readonly favorite: boolean;
  readonly effectiveVisited: boolean;
  readonly personalRating?: number;
  readonly overallComment?: string;
}

interface PublicMedia {
  readonly id: string;
  readonly visitId: string;
  readonly displayOrder: number;
  readonly caption?: string;
  readonly displayUrl: string;
}

interface PublicVisit {
  readonly id: string;
  readonly itemId: string;
  readonly visitedOn: string;
  readonly displayNote?: string;
  readonly media: readonly PublicMedia[];
}

export async function loadPublicCatalog(
  transport: ReadTransport,
): Promise<readonly AtlasItem[]> {
  const catalog = await getJson<readonly AtlasItem[]>(transport, '/api/items');
  return Promise.all(
    catalog.map(async (item) => {
      if (!item.reservation) return item;
      const assessment = await getJson<PublicAssessment>(
        transport,
        `/api/items/${encodeURIComponent(item.id)}/personal`,
      );
      return {
        ...item,
        verifiedAt: item.verifiedAt ?? item.reservation.checkedAt,
        personalState: assessment.effectiveVisited
          ? 'visited'
          : assessment.favorite
            ? 'saved'
            : 'candidate',
        personalRating: assessment.personalRating,
        overallComment: assessment.overallComment,
        isFavorite: assessment.favorite,
        hasVisited: assessment.effectiveVisited,
      };
    }),
  );
}

export async function loadPublicVisits(
  transport: ReadTransport,
): Promise<readonly VisitRecord[]> {
  const visits = await getJson<readonly PublicVisit[]>(
    transport,
    '/api/journal',
  );
  const titles = new Map<string, string>();
  await Promise.all(
    [...new Set(visits.map((visit) => visit.itemId))].map(async (itemId) => {
      const item = await getJson<Pick<AtlasItem, 'title'>>(
        transport,
        `/api/items/${encodeURIComponent(itemId)}`,
      );
      titles.set(itemId, item.title);
    }),
  );
  return visits.map((visit) => ({
    id: visit.id,
    itemId: visit.itemId,
    itemTitle: titles.get(visit.itemId) ?? visit.itemId,
    visitedAt: visit.visitedOn,
    note: visit.displayNote,
    createdAt: visit.visitedOn,
    updatedAt: visit.visitedOn,
  }));
}

export async function loadPublicMedia(
  transport: ReadTransport,
  filters: { readonly visitId?: string; readonly itemId?: string },
): Promise<readonly VisitMediaRecord[]> {
  const search = new URLSearchParams();
  if (filters.visitId) search.set('visitId', filters.visitId);
  if (filters.itemId) search.set('itemId', filters.itemId);
  const privateResponse = await transport.request(
    `/api/media${search.size ? `?${search.toString()}` : ''}`,
    { headers: { 'content-type': 'application/json' } },
  );
  if (privateResponse.ok) {
    return (await privateResponse.json()) as readonly VisitMediaRecord[];
  }
  if (privateResponse.status !== 401) {
    throw new Error(
      (await privateResponse.text()) ||
        `Request failed (${privateResponse.status})`,
    );
  }

  const visits = await getJson<readonly PublicVisit[]>(
    transport,
    '/api/journal',
  );
  return visits.flatMap((visit) =>
    visit.media
      .filter(
        (media) =>
          (!filters.visitId || media.visitId === filters.visitId) &&
          (!filters.itemId || visit.itemId === filters.itemId),
      )
      .map((media) => ({
        id: media.id,
        visitId: media.visitId,
        itemId: visit.itemId,
        originalFilename: 'Photo',
        caption: media.caption,
        displayOrder: media.displayOrder,
        contentUrl: media.displayUrl,
      })),
  );
}

async function getJson<T>(transport: ReadTransport, url: string): Promise<T> {
  const response = await transport.request(url, {
    headers: { 'content-type': 'application/json' },
  });
  if (!response.ok) {
    throw new Error(
      (await response.text()) || `Request failed (${response.status})`,
    );
  }
  return (await response.json()) as T;
}
