import type { AtlasItem } from '../catalog/atlas-item.ts';

type SearchableRestaurant = Pick<
  AtlasItem,
  'kind' | 'title' | 'alternateTitle' | 'verificationStatus'
>;

export function searchCatalogRestaurantsByName<T extends SearchableRestaurant>(
  items: readonly T[],
  query: string,
): T[] {
  const needle = query.trim().normalize('NFKC').toLowerCase();
  return items.filter(
    (item) =>
      item.kind === 'food' &&
      item.verificationStatus === 'verified' &&
      (!needle ||
        item.title.normalize('NFKC').toLowerCase().includes(needle) ||
        (item.alternateTitle
          ?.normalize('NFKC')
          .toLowerCase()
          .includes(needle) ??
          false)),
  );
}

export function matchesAtlasQuery(item: AtlasItem, query: string): boolean {
  const rawTokens = query.trim().split(/\s+/u).filter(Boolean);
  if (!rawTokens.length) return true;

  const fields = [
    item.title,
    item.alternateTitle ?? '',
    item.area,
    item.address,
    item.description,
    ...item.tags,
  ].map(normalizeSearchText);

  return rawTokens.every((rawToken) => {
    const token = normalizeSearchText(rawToken);
    if (!token) return true;
    return fields.some(
      (field) =>
        Boolean(field) &&
        (field.includes(token) ||
          token.includes(field) ||
          (token.length >= 3 && bigramSimilarity(field, token) >= 0.5)),
    );
  });
}

export function matchesAtlasNameQuery(
  item: Pick<AtlasItem, 'title' | 'alternateTitle'>,
  query: string,
): boolean {
  return matchesAtlasTextQuery([item.title, item.alternateTitle ?? ''], query);
}

export function matchesAtlasTextQuery(
  fields: readonly string[],
  query: string,
): boolean {
  const tokens = query.trim().split(/\s+/u).filter(Boolean);
  if (!tokens.length) return true;
  const names = fields.map(normalizeSearchText);
  return tokens.every((rawToken) => {
    const token = normalizeSearchText(rawToken);
    return !token || names.some((name) => name.includes(token));
  });
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}

function bigrams(value: string): Set<string> {
  if (value.length < 2) return new Set([value]);
  return new Set(
    Array.from({ length: value.length - 1 }, (_, index) =>
      value.slice(index, index + 2),
    ),
  );
}

function bigramSimilarity(left: string, right: string): number {
  const leftBigrams = bigrams(left);
  const rightBigrams = bigrams(right);
  let overlap = 0;
  for (const token of leftBigrams) {
    if (rightBigrams.has(token)) overlap += 1;
  }
  return (2 * overlap) / Math.max(1, leftBigrams.size + rightBigrams.size);
}
