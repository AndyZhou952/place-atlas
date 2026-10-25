import { readBoundedText } from '../http.ts';

/** Resolve a Japanese place name (station, area, address) with OpenStreetMap Nominatim. */
export async function geocodeJapan(
  query: string,
  contact = 'https://github.com/AndyZhou952/place-atlas',
  fetcher: typeof fetch = fetch,
): Promise<{ label: string; latitude: number; longitude: number } | undefined> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    countrycodes: 'jp',
    limit: '1',
    'accept-language': 'ja',
  }).toString();
  const response = await fetcher(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(6000),
    // Nominatim's usage policy requires an identifying User-Agent.
    headers: { 'user-agent': `JapanAtlas/0.2 (+${contact})`, accept: 'application/json' },
  });
  if (!response.ok) return undefined;
  const [first] = JSON.parse(await readBoundedText(response, 65_536)) as {
    display_name?: string;
    lat?: string;
    lon?: string;
  }[];
  const latitude = Number(first?.lat);
  const longitude = Number(first?.lon);
  return first && Number.isFinite(latitude) && Number.isFinite(longitude)
    ? { label: String(first.display_name ?? query).split(',')[0], latitude, longitude }
    : undefined;
}
