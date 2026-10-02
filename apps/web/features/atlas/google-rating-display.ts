import type { AtlasItem, TabelogSnapshot } from './model.ts';
import { researchRegion } from '../../product/application/catalog/research-region.ts';

export type GoogleRatingStatus = 'loading' | 'loaded' | 'unavailable';
export interface GoogleRatingDisplay {
  readonly identity: string;
  readonly status: GoogleRatingStatus;
  readonly rating?: TabelogSnapshot;
}
export function googleRatingIdentity(item: AtlasItem): string {
  return JSON.stringify([
    item.id,
    item.address,
    item.googlePlaceId ?? item.intakeEvidence?.candidateIdentity,
  ]);
}
export function parseGoogleRating(
  value: unknown,
  checkedAt: string,
): TabelogSnapshot | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  if (
    typeof v.score !== 'number' ||
    !Number.isFinite(v.score) ||
    v.score < 0 ||
    v.score > 5 ||
    typeof v.url !== 'string'
  )
    return undefined;
  if (
    v.reviewCount !== undefined &&
    (typeof v.reviewCount !== 'number' ||
      !Number.isSafeInteger(v.reviewCount) ||
      v.reviewCount < 0)
  )
    return undefined;
  try {
    const url = new URL(v.url);
    if (
      url.protocol !== 'https:' ||
      !['maps.google.com', 'www.google.com', 'maps.app.goo.gl'].includes(
        url.hostname,
      )
    )
      return undefined;
  } catch {
    return undefined;
  }
  return {
    score: v.score,
    url: v.url,
    checkedAt,
    ...(v.reviewCount === undefined
      ? {}
      : { reviewCount: v.reviewCount as number }),
  };
}
export function withDisplayedGoogleRatings(
  items: readonly AtlasItem[],
  displays: Readonly<Record<string, GoogleRatingDisplay>>,
): readonly AtlasItem[] {
  return items.map((item) => {
    if (researchRegion(item.address) === 'mainland_china')
      return { ...item, googleRating: undefined };
    const display = displays[item.id];
    return display?.identity === googleRatingIdentity(item) && display.rating
      ? { ...item, googleRating: display.rating }
      : item;
  });
}
