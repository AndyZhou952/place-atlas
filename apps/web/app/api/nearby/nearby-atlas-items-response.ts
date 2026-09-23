import type { AtlasApplication } from '@/product/application/atlas-application';
import type { createDecisionOperationGroup } from '@/product/application/decision/decision-operations';
import type { createNearbyRecommendationOperationGroup } from '@/product/application/decision/agent-nearby-operation';

type NearbyHttpApplication = AtlasApplication<
  ReturnType<typeof createDecisionOperationGroup> &
    ReturnType<typeof createNearbyRecommendationOperationGroup>
>;

export async function nearbyAtlasItemsResponse(
  application: NearbyHttpApplication,
  searchParams: URLSearchParams,
): Promise<Response> {
  const locationHintValue = searchParams.get('locationHint');
  if (locationHintValue !== null) {
    return nearbyRecommendationResponse(application, locationHintValue);
  }

  const latitudeValue = searchParams.get('lat');
  const longitudeValue = searchParams.get('lon');
  const latitude = parseRequiredCoordinate(latitudeValue);
  const longitude = parseRequiredCoordinate(longitudeValue);
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return noStoreTextResponse(
      'Valid lat and lon query parameters are required',
      400,
    );
  }

  const requestedLimit = Number(searchParams.get('limit') ?? 5);
  const limit = Math.min(Math.max(Math.floor(requestedLimit) || 5, 1), 20);
  const requestedProfile = searchParams.get('profile');
  if (
    requestedProfile !== null &&
    requestedProfile !== 'verified_catalog' &&
    requestedProfile !== 'full_merged_catalog'
  ) {
    return noStoreTextResponse('A valid catalog profile is required', 400);
  }
  const result = await application.execute({
    key: 'decision.nearby',
    input: {
      latitude,
      longitude,
      limit,
      profile:
        requestedProfile === 'full_merged_catalog'
          ? 'full_merged_catalog'
          : 'verified_catalog',
    },
  });
  if (!result.ok) {
    return noStoreTextResponse(
      result.error.kind === 'invalid_input'
        ? 'Valid lat and lon query parameters are required'
        : 'Nearby Atlas items are temporarily unavailable.',
      result.error.kind === 'invalid_input' ? 400 : 500,
    );
  }
  return noStoreJsonResponse(result.value);
}

async function nearbyRecommendationResponse(
  application: NearbyHttpApplication,
  locationHintValue: string,
): Promise<Response> {
  const locationHint = locationHintValue.trim();
  if (
    !locationHint ||
    locationHint.length > 1_000 ||
    /[\r\n]/u.test(locationHint)
  ) {
    return noStoreTextResponse(
      'A valid locationHint query parameter is required',
      400,
    );
  }

  const result = await application.execute({
    key: 'nearby.recommend',
    input: { locationHint },
  });
  if (!result.ok) {
    return noStoreTextResponse(
      result.error.kind === 'invalid_input'
        ? 'A valid locationHint query parameter is required'
        : 'Nearby recommendations are temporarily unavailable.',
      result.error.kind === 'invalid_input' ? 400 : 503,
    );
  }
  return noStoreJsonResponse(result.value);
}

function parseRequiredCoordinate(value: string | null): number {
  return value === null || !value.trim() ? Number.NaN : Number(value);
}

function noStoreTextResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

function noStoreJsonResponse(value: unknown): Response {
  return Response.json(value, {
    headers: { 'cache-control': 'no-store' },
  });
}
