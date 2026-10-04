interface Candidate {
  readonly candidateIdentity: {
    readonly providerNamespace: string;
    readonly placeId: string;
  };
  readonly ownerFields: { readonly address?: string };
  readonly addressProposal?: { readonly value: string };
  readonly locationEvidence:
    | { readonly status: 'unknown' }
    | {
        readonly status: 'known';
        readonly latitude: number;
        readonly longitude: number;
      };
  readonly tabelog:
    | { readonly status: 'unknown' }
    | { readonly status: 'known'; readonly url: string };
}

export interface SavedPlace {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly address: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly tabelog?: { readonly url: string };
  readonly sources: readonly { readonly role: string; readonly url: string }[];
  readonly intakeEvidence?: {
    readonly candidateIdentity: {
      readonly providerNamespace: string;
      readonly placeId: string;
    };
  };
}

interface DuplicateMatch {
  readonly itemId: string;
  readonly title: string;
  readonly address: string;
  readonly match: 'strong' | 'weak';
}

/** Stable identities win; a shared building is only a warning, never proof. */
export function findSavedPlaceDuplicates(
  candidate: Candidate,
  saved: readonly SavedPlace[],
): readonly DuplicateMatch[] {
  const proposedAddress =
    candidate.ownerFields.address ?? candidate.addressProposal?.value;
  const proposedTabelog =
    candidate.tabelog.status === 'known'
      ? canonicalTabelog(candidate.tabelog.url)
      : undefined;
  const results: DuplicateMatch[] = [];
  for (const item of saved) {
    if (item.kind !== 'food') continue;
    const priorIdentity = item.intakeEvidence?.candidateIdentity;
    const sameProviderIdentity =
      priorIdentity?.providerNamespace ===
        candidate.candidateIdentity.providerNamespace &&
      priorIdentity.placeId === candidate.candidateIdentity.placeId;
    const existingTabelog =
      canonicalTabelog(item.tabelog?.url) ??
      item.sources
        .filter((source) => source.role === 'tabelog')
        .map((source) => canonicalTabelog(source.url))
        .find(Boolean);
    const sameTabelog = Boolean(
      proposedTabelog && existingTabelog && proposedTabelog === existingTabelog,
    );
    const sameLocation =
      candidate.locationEvidence.status === 'known' &&
      locationDistanceMeters(
        candidate.locationEvidence.latitude,
        candidate.locationEvidence.longitude,
        item.latitude,
        item.longitude,
      ) <= 35 &&
      Boolean(
        proposedAddress && matchingStreetNumbers(proposedAddress, item.address),
      );
    if (!sameProviderIdentity && !sameTabelog && !sameLocation) continue;
    results.push({
      itemId: item.id,
      title: item.title,
      address: item.address,
      match: sameProviderIdentity || sameTabelog ? 'strong' : 'weak',
    });
  }
  return results
    .sort(
      (a, b) =>
        Number(b.match === 'strong') - Number(a.match === 'strong') ||
        a.itemId.localeCompare(b.itemId),
    )
    .slice(0, 5);
}

function canonicalTabelog(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      !['tabelog.com', 'www.tabelog.com'].includes(url.hostname)
    )
      return undefined;
    const path = url.pathname
      .replace(/^\/(?:en|tw|cn|kr)\//u, '/')
      .replace(/\/$/u, '');
    return /^\/[a-z]+\/A\d+\/A\d+\/\d{7,8}$/u.test(path) ? path : undefined;
  } catch {
    return undefined;
  }
}

function matchingStreetNumbers(first: string, second: string): boolean {
  const numbers = (value: string) =>
    value
      .replace(/[０-９]/gu, (digit) =>
        String.fromCharCode(digit.charCodeAt(0) - 0xfee0),
      )
      .replace(/ch[ōo]me|丁目|番地|番|号/giu, '-')
      .replace(/[\s‐‑‒–—−ー－]/gu, '-')
      .replace(/-+/gu, '-')
      .match(/\d{1,4}-\d{1,4}-\d{1,4}/u)?.[0];
  const a = numbers(first);
  return Boolean(a && a === numbers(second));
}

function locationDistanceMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
): number {
  const radians = Math.PI / 180;
  const latitudeDifference = (latitudeB - latitudeA) * radians;
  const longitudeDifference = (longitudeB - longitudeA) * radians;
  const a =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(latitudeA * radians) *
      Math.cos(latitudeB * radians) *
      Math.sin(longitudeDifference / 2) ** 2;
  return 12_742_000 * Math.asin(Math.min(1, Math.sqrt(a)));
}
