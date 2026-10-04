/** Fixed stage codes only: never log owner queries, place names, URLs, or model text. */
export function recordCatalogResearchDiagnostic(code: string): void {
  if (!/^[a-z0-9_]{1,64}$/u.test(code)) return;
  console.info('catalog_research', code);
}
