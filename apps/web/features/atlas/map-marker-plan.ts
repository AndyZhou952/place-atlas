import type { MapItem } from './map-adapter';

export interface MarkerPlan {
  readonly item: MapItem;
  readonly latitude: number;
  readonly longitude: number;
  readonly signature: string;
}

export function buildMarkerPlan(items: readonly MapItem[]): MarkerPlan[] {
  const coordinateCounts = new Map<string, number>();
  return items.map((item) => {
    const coordinateKey = `${item.latitude.toFixed(4)},${item.longitude.toFixed(4)}`;
    const sameLocationIndex = coordinateCounts.get(coordinateKey) ?? 0;
    coordinateCounts.set(coordinateKey, sameLocationIndex + 1);
    const offset = sameLocationIndex * 0.00018;
    const latitude = item.latitude + offset;
    const longitude = item.longitude + offset;
    return {
      item,
      latitude,
      longitude,
      signature: JSON.stringify([item.kind, item.title, latitude, longitude]),
    };
  });
}

export function markerDiff(
  current: ReadonlyMap<string, string>,
  next: readonly MarkerPlan[],
): { readonly remove: string[]; readonly upsert: MarkerPlan[] } {
  const nextIds = new Set(next.map((entry) => entry.item.id));
  return {
    remove: [...current.keys()].filter((id) => !nextIds.has(id)),
    upsert: next.filter(
      (entry) => current.get(entry.item.id) !== entry.signature,
    ),
  };
}
