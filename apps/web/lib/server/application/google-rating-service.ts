import { getD1, getOwnerPocCatalogIntakeRuntime } from '../../../db/index.ts';
import { D1ProviderUsage } from '../../../adapters/agent/d1-provider-usage.ts';
import { createGooglePlaceRatingClient } from '../../../adapters/providers/google-places-new-client.ts';
import { ratingPlaceId } from '../../../agent/google-rating-policy.ts';
import { previewRatingPlaceId } from '../../../agent/google-rating-policy.ts';
import { D1CatalogIntakeState } from './d1-catalog-intake-state.ts';
import { isAtlasItem } from '../../../product/application/catalog/catalog-projection.ts';
import { getServerAtlasApplication } from './server-atlas-application.ts';

export async function getSavedPlaceGoogleRating(id: string) {
  const result = await getServerAtlasApplication().execute({
    key: 'catalog.get',
    input: { id },
  });
  if (!result.ok || !isAtlasItem(result.value))
    return { kind: 'not_found' } as const;
  const placeId = ratingPlaceId(result.value);
  if (!placeId) return { kind: 'unavailable' } as const;
  return getRatingByPlaceId(placeId);
}

export async function getPreviewGoogleRating(
  sessionId: string,
  conversationId: string,
) {
  const session = await new D1CatalogIntakeState(getD1()).get(
    { ownerId: 'owner', channel: 'web', conversationId },
    sessionId,
  );
  if (!session || session.state !== 'preview_ready')
    return { kind: 'not_found' } as const;
  const placeId = previewRatingPlaceId(session);
  if (!placeId) return { kind: 'unavailable' } as const;
  return getRatingByPlaceId(placeId);
}

async function getRatingByPlaceId(placeId: string) {
  const runtime = getOwnerPocCatalogIntakeRuntime();
  if (
    runtime.providerModes.googlePlaces !== 'enabled' ||
    !runtime.googlePlacesApiKey
  )
    return { kind: 'unavailable' } as const;
  const rating = await createGooglePlaceRatingClient({
    apiKey: runtime.googlePlacesApiKey,
    usage: new D1ProviderUsage(getD1(), () => new Date()),
  }).getRating(placeId);
  return rating.ok
    ? ({ kind: 'found', value: rating.value } as const)
    : ({ kind: 'unavailable' } as const);
}
