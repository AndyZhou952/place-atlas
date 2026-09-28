import type { AtlasItem } from '../product/application/catalog/atlas-item.ts';
import { researchRegion } from '../product/application/catalog/research-region.ts';

export function ratingPlaceId(item: AtlasItem): string | undefined {
  if (item.kind !== 'food') return undefined;
  const region = researchRegion(item.address);
  if (region === 'mainland_china' || (region === 'japan' && item.tabelog))
    return undefined;
  const identity = item.intakeEvidence?.candidateIdentity;
  return identity?.providerNamespace === 'google-places' &&
    /^[A-Za-z0-9_-]{10,500}$/u.test(identity.placeId)
    ? identity.placeId
    : undefined;
}
