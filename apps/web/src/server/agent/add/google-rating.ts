// Google ratings through the metered Places client. Rating content is request scoped; a saved
// place stores only an Owner-requested reference, and an Add preview stages one for confirm.
import type { GoogleRating } from '../../../shared/types.ts';
import type { Env } from '../../env.ts';
import { googleKey } from '../../env.ts';
import { createGooglePlaceRatingClient } from '../discovery/google-places.ts';
import { D1ProviderUsage } from '../discovery/quota.ts';
import type { CatalogIntakePreviewSession } from './coordinator.ts';
import { D1CatalogIntakeState } from './d1-session-state.ts';

const PLACE_ID = /^[A-Za-z0-9_-]{10,500}$/u;

export async function fetchGoogleRating(
  env: Env,
  placeId: string,
): Promise<GoogleRating | undefined> {
  const apiKey = googleKey(env);
  if (!apiKey || !PLACE_ID.test(placeId)) return undefined;
  const rating = await createGooglePlaceRatingClient({
    apiKey,
    usage: new D1ProviderUsage(env.DB, () => new Date()),
  }).getRating(placeId);
  return rating.ok ? { ...rating.value, observedAt: new Date().toISOString() } : undefined;
}

function previewPlaceId(session: CatalogIntakePreviewSession, now = new Date()) {
  const { preview } = session;
  if (Date.parse(preview.expiresAt) <= now.getTime()) return undefined;
  const identity = preview.candidateIdentity;
  return identity.providerNamespace === 'google-places' && PLACE_ID.test(identity.placeId)
    ? identity.placeId
    : undefined;
}

/** The live rating for an Add preview, staged on that exact preview for confirmation. */
export async function previewGoogleRating(
  env: Env,
  sessionId: string,
  conversationId: string,
): Promise<GoogleRating | 'not_found' | undefined> {
  const session = await new D1CatalogIntakeState(env.DB).get(
    { ownerId: 'owner', channel: 'web', conversationId },
    sessionId,
  );
  if (!session || session.state !== 'preview_ready') return 'not_found';
  const placeId = previewPlaceId(session);
  const rating = placeId ? await fetchGoogleRating(env, placeId) : undefined;
  if (placeId && rating) {
    await env.DB.prepare(
      `UPDATE catalog_intake_sessions SET google_rating_reference_json = ?
       WHERE session_id = ? AND owner_id = 'owner' AND channel = 'web' AND conversation_id = ?
       AND state = 'preview_ready' AND expires_at_ms > ?
       AND json_extract(session_json, '$.preview.evidenceDigest') = ?`,
    )
      .bind(
        JSON.stringify({
          placeId,
          score: rating.score,
          reviewCount: rating.reviewCount,
          url: rating.url,
          observedAt: rating.observedAt,
          source: 'google_places_api',
        }),
        sessionId,
        conversationId,
        Date.now(),
        session.preview.evidenceDigest,
      )
      .run();
  }
  return rating;
}
