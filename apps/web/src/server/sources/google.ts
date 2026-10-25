import type { GoogleRating } from '../../shared/types.ts';
import { readBoundedText } from '../http.ts';

// Google Places API (New). Optional: used only when GOOGLE_PLACES_API_KEY is configured.

export interface GooglePlace {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly latitude: number;
  readonly longitude: number;
}

async function call(
  apiKey: string,
  url: string,
  fieldMask: string,
  body?: unknown,
  fetcher: typeof fetch = fetch,
) {
  const response = await fetcher(url, {
    method: body ? 'POST' : 'GET',
    redirect: 'manual',
    signal: AbortSignal.timeout(8000),
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': apiKey,
      'x-goog-fieldmask': fieldMask,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`Google Places returned HTTP ${response.status}`);
  return JSON.parse(await readBoundedText(response, 262_144));
}

interface PlaceResponse {
  readonly id?: unknown;
  readonly displayName?: { readonly text?: string };
  readonly formattedAddress?: string;
  readonly location?: { readonly latitude?: number; readonly longitude?: number };
}

const toPlace = (place: PlaceResponse): GooglePlace[] =>
  typeof place?.id === 'string' && typeof place.location?.latitude === 'number'
    ? [
        {
          id: place.id,
          name: String(place.displayName?.text ?? ''),
          address: String(place.formattedAddress ?? '').replace(/^日本、(〒\d{3}-\d{4} )?/u, ''),
          latitude: place.location.latitude,
          longitude: Number(place.location.longitude),
        },
      ]
    : [];

/** Text search limited to Japan, optionally biased to a point (e.g. a Tabelog location). */
export async function searchGooglePlaces(
  apiKey: string,
  query: string,
  near?: { readonly latitude: number; readonly longitude: number },
  fetcher?: typeof fetch,
): Promise<GooglePlace[]> {
  const body = await call(
    apiKey,
    'https://places.googleapis.com/v1/places:searchText',
    'places.id,places.displayName,places.formattedAddress,places.location',
    {
      textQuery: query,
      languageCode: 'ja',
      regionCode: 'JP',
      pageSize: 5,
      ...(near ? { locationBias: { circle: { center: near, radius: 300 } } } : {}),
    },
    fetcher,
  );
  return (Array.isArray(body.places) ? body.places : []).flatMap(toPlace);
}

export async function getGooglePlace(
  apiKey: string,
  placeId: string,
  fetcher?: typeof fetch,
): Promise<GooglePlace | undefined> {
  const body = await call(
    apiKey,
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=ja`,
    'id,displayName,formattedAddress,location',
    undefined,
    fetcher,
  );
  return toPlace(body)[0];
}

export async function getGoogleRating(
  apiKey: string,
  placeId: string,
  fetcher?: typeof fetch,
): Promise<GoogleRating | undefined> {
  const body = await call(
    apiKey,
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
    'id,rating,userRatingCount,googleMapsUri',
    undefined,
    fetcher,
  );
  if (typeof body.rating !== 'number' || typeof body.googleMapsUri !== 'string') return undefined;
  return {
    score: body.rating,
    ...(Number.isInteger(body.userRatingCount) ? { reviewCount: body.userRatingCount } : {}),
    url: body.googleMapsUri,
    observedAt: new Date().toISOString(),
  };
}
