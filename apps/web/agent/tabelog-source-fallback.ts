import type { RestaurantSourceReader } from './browser-source-reader.ts';

/** Retry only the same validated listing when the primary transport fails or omits geo. */
export function withSameListingFallback(
  primary: RestaurantSourceReader,
  fallback: RestaurantSourceReader,
  diagnostic?: (code: string) => void,
): RestaurantSourceReader {
  return async (url, signal) => {
    const first = await primary(url, signal);
    diagnostic?.(
      first.kind === 'read'
        ? first.evidence.restaurant?.coordinates
          ? 'tabelog_primary_read_geo'
          : 'tabelog_primary_read_no_geo'
        : `tabelog_primary_${first.kind}`,
    );
    if (
      signal.aborted ||
      (first.kind === 'read' &&
        (first.evidence.restaurant?.coordinates || first.evidence.nameBridge))
    )
      return first;
    const second = await fallback(url, signal);
    diagnostic?.(
      second.kind === 'read'
        ? second.evidence.restaurant?.coordinates
          ? 'tabelog_fallback_read_geo'
          : 'tabelog_fallback_read_no_geo'
        : `tabelog_fallback_${second.kind}`,
    );
    if (second.kind === 'read') {
      if (first.kind !== 'read' || second.evidence.restaurant?.coordinates)
        return second;
      return first;
    }
    if (first.kind === 'read') return first;
    if (first.kind === 'blocked' || second.kind === 'blocked')
      return { kind: 'blocked' };
    return first.kind === 'invalid_source' ? first : second;
  };
}
