import type { RouteSidecarPoint } from './route-sidecar-contract.ts';

const japanRailRegions = [
  { south: 33.3, north: 41.6, west: 131.4, east: 142.2 },
  { south: 30.2, north: 34.5, west: 129.3, east: 132.2 },
  { south: 32.5, north: 34.5, west: 132, east: 135.6 },
  { south: 41.4, north: 45.7, west: 139.2, east: 146.1 },
  { south: 24, north: 27.6, west: 122.8, east: 129 },
  { south: 33.9, north: 34.7, west: 129, east: 130 },
] as const;

export function isJapanTransitArea(point: RouteSidecarPoint): boolean {
  return japanRailRegions.some(
    (region) =>
      point.latitude >= region.south &&
      point.latitude <= region.north &&
      point.longitude >= region.west &&
      point.longitude <= region.east,
  );
}
