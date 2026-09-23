export type CatalogIntakeWarningCode =
  | 'stale_evidence'
  | 'provider_unavailable'
  | 'source_conflict'
  | 'needs_review';

interface WarningLike {
  readonly code: CatalogIntakeWarningCode;
  readonly message: string;
}

export const catalogIntakeWarningOrder = [
  'stale_evidence',
  'provider_unavailable',
  'source_conflict',
  'needs_review',
] as const;

export function canonicalizeCatalogIntakeWarnings<T extends WarningLike>(
  warnings: readonly T[],
): readonly T[] {
  const latestByCode = new Map(
    warnings.map((warning) => [warning.code, warning] as const),
  );
  return catalogIntakeWarningOrder.flatMap((code) => {
    const warning = latestByCode.get(code);
    return warning ? [warning] : [];
  });
}

export function hasCanonicalCatalogIntakeWarningOrder(
  warnings: unknown,
): warnings is readonly unknown[] {
  if (!Array.isArray(warnings) || warnings.length > 4) return false;
  const codes = warnings.map((warning) =>
    isRecord(warning) ? warning.code : undefined,
  );
  return codes.every(
    (code, index) =>
      typeof code === 'string' &&
      catalogIntakeWarningOrder.includes(
        code as (typeof catalogIntakeWarningOrder)[number],
      ) &&
      (index === 0 ||
        catalogIntakeWarningOrder.indexOf(
          codes[index - 1] as (typeof catalogIntakeWarningOrder)[number],
        ) <
          catalogIntakeWarningOrder.indexOf(
            code as (typeof catalogIntakeWarningOrder)[number],
          )),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
