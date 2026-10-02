import type { AtlasItem } from '../product/application/catalog/atlas-item.ts';
import type { CatalogIntakePreviewSession } from '../product/application/catalog-intake/catalog-intake-coordinator.ts';
import { researchRegion } from '../product/application/catalog/research-region.ts';

export function ratingPlaceId(item: AtlasItem): string | undefined {
  if (item.kind !== 'food') return undefined;
  const region = researchRegion(item.address);
  if (region === 'mainland_china') return undefined;
  const identity = item.intakeEvidence?.candidateIdentity;
  const placeId =
    identity?.providerNamespace === 'google-places'
      ? identity.placeId
      : item.googlePlaceId;
  return typeof placeId === 'string' && /^[A-Za-z0-9_-]{10,500}$/u.test(placeId)
    ? placeId
    : undefined;
}

export function previewRatingPlaceId(
  session: CatalogIntakePreviewSession,
  now = new Date(),
): string | undefined {
  const preview = session.preview;
  if (Date.parse(preview.expiresAt) <= now.getTime()) return undefined;
  const identity = preview.candidateIdentity;
  if (identity.providerNamespace !== 'google-places') return undefined;
  if (!/^[A-Za-z0-9_-]{10,500}$/u.test(identity.placeId)) return undefined;
  const region = researchRegion(
    [
      session.ownerQuery,
      preview.ownerFields.address,
      preview.addressProposal?.value,
      preview.profile?.address?.value,
    ]
      .filter(Boolean)
      .join(' '),
  );
  if (
    region === 'mainland_china' ||
    (region === 'japan' && preview.tabelog.status === 'known')
  )
    return undefined;
  return identity.placeId;
}
