import type { AtlasApplication } from '@/product/application/atlas-application';
import type { createDecisionOperationGroup } from '@/product/application/decision/decision-operations';

type DecisionApplication = AtlasApplication<
  ReturnType<typeof createDecisionOperationGroup>
>;

export async function nearbyAtlasItemsResponse(
  application: DecisionApplication,
  searchParams: URLSearchParams,
): Promise<Response> {
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
    return new Response('Valid lat and lon query parameters are required', {
      status: 400,
    });
  }

  const requestedLimit = Number(searchParams.get('limit') ?? 5);
  const limit = Math.min(Math.max(Math.floor(requestedLimit) || 5, 1), 20);
  const requestedProfile = searchParams.get('profile');
  if (
    requestedProfile !== null &&
    requestedProfile !== 'verified_catalog' &&
    requestedProfile !== 'full_merged_catalog'
  ) {
    return new Response('A valid catalog profile is required', { status: 400 });
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
    return new Response(
      result.error.kind === 'invalid_input'
        ? 'Valid lat and lon query parameters are required'
        : 'Nearby Atlas items are temporarily unavailable.',
      { status: result.error.kind === 'invalid_input' ? 400 : 500 },
    );
  }
  return Response.json(result.value);
}

function parseRequiredCoordinate(value: string | null): number {
  return value === null || !value.trim() ? Number.NaN : Number(value);
}
