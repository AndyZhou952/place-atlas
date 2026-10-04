export const atlasTileProvider = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  attribution: '&copy; OpenStreetMap contributors',
  maxZoom: 19,
  keepBuffer: 2,
} as const;

export const atlasMapPerformanceBudget = {
  maximumLongTaskMs: 200,
  maximumFrameGapP95Ms: 50,
  maximumFrameGapMs: 100,
  maximumFixtureTileSettleP95Ms: 400,
} as const;
