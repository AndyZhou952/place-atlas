import type { AtlasItem } from './model';

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}

function bigrams(value: string): Set<string> {
  if (value.length < 2) return new Set([value]);
  return new Set(
    Array.from({ length: value.length - 1 }, (_, i) => value.slice(i, i + 2)),
  );
}

function similarity(left: string, right: string): number {
  const a = bigrams(left);
  const b = bigrams(right);
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return (2 * overlap) / Math.max(1, a.size + b.size);
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
  ].map(normalize);

  return rawTokens.every((rawToken) => {
    const token = normalize(rawToken);
    if (!token) return true;
    return fields.some(
      (field) =>
        field.includes(token) ||
        token.includes(field) ||
        (token.length >= 3 && similarity(field, token) >= 0.5),
    );
  });
}
