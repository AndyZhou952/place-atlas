export function savedDuplicateIds(sample, catalog) {
  if (!Array.isArray(catalog)) throw new Error('Invalid live catalog snapshot');
  const url = sample.expectedTabelogUrl ?? sample.expectedBookingLink;
  if (!url) throw new Error('Live case requires an independent identity URL');
  return catalog
    .filter(
      (item) =>
        item.kind === 'food' &&
        item.verificationStatus === 'verified' &&
        (item.tabelog?.url === url ||
          item.sources?.some((source) => source.url === url)),
    )
    .map((item) => item.id);
}
