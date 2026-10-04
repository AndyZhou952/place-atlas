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
  const result = await getRatingByPlaceId(placeId);
  if (result.kind === 'found') {
    const { score, reviewCount, url, checkedAt } = result.value;
    // Stage only the response for this exact preview; confirmation owns publication.
    await getD1()
      .prepare(`UPDATE catalog_intake_sessions SET google_rating_reference_json = ?
      WHERE session_id = ? AND owner_id = 'owner' AND channel = 'web' AND conversation_id = ?
      AND state = 'preview_ready' AND expires_at_ms > ?
      AND json_extract(session_json, '$.preview.evidenceDigest') = ?`)
      .bind(
        JSON.stringify({
          placeId,
          score,
          reviewCount,
          url,
          observedAt: checkedAt,
          source: 'google_places_api',
        }),
        sessionId,
        conversationId,
        Date.now(),
        session.preview.evidenceDigest,
      )
      .run();
  }
  return result;
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
    ? ({
        kind: 'found',
        value: { ...rating.value, checkedAt: new Date().toISOString() },
      } as const)
    : ({ kind: 'unavailable' } as const);
}
