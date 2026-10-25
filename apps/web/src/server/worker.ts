import { normalizeRating } from '../shared/text.ts';
import type { RestaurantPatch, VisitInput } from '../shared/types.ts';
import { cleanupAddState } from './agent/add/compose.ts';
import { fetchGoogleRating, previewGoogleRating } from './agent/add/google-rating.ts';
import { AGENT_CAPABILITIES, agentAddResponse, ownerAddResponse } from './agent/add/http.ts';
import { createRecommendHarness } from './agent/recommend/compose.ts';
import { parseRecommendConversationInput } from '../shared/recommend-conversation.ts';
import { isOwner, login, logout, ownerWebConversationId, requireOwner } from './auth.ts';
import * as db from './db.ts';
import type { Env } from './env.ts';
import {
  HttpError,
  errorResponse,
  isoDate,
  json,
  optionalString,
  readJson,
  requiredString,
  uuid,
} from './http.ts';
import { removeSettings, saveSettings, settingsStatus } from './settings.ts';

type Handler = (request: Request, env: Env, params: string[]) => Promise<Response>;
type Access = 'public' | 'owner' | 'self';

// [method, path pattern, access, handler]. `:id` segments become params.
const routes: [string, string, Access, Handler][] = [
  [
    'GET',
    '/api/session',
    'public',
    async (request, env) => json({ owner: await isOwner(request, env) }),
  ],
  ['POST', '/api/session', 'public', (request, env) => login(request, env)],
  ['DELETE', '/api/session', 'public', async (request) => logout(request)],

  [
    'GET',
    '/api/restaurants',
    'public',
    async (_request, env) => json(await db.listRestaurants(env.DB)),
  ],
  [
    'PATCH',
    '/api/restaurants/:id',
    'owner',
    async (request, env, [id]) =>
      json(await db.updateRestaurant(env.DB, id, parsePatch(await readJson(request)))),
  ],
  [
    'DELETE',
    '/api/restaurants/:id',
    'owner',
    async (_request, env, [id]) => {
      await db.deleteRestaurant(env.DB, env.MEDIA, id);
      return json({ deleted: id });
    },
  ],

  ['GET', '/api/visits', 'public', async (_request, env) => json(await db.listVisits(env.DB))],
  [
    'POST',
    '/api/visits',
    'owner',
    async (request, env) => {
      const body = await readJson(request);
      const id = uuid(body.id);
      await db.saveVisit(env.DB, id, parseVisit(body), true);
      return json({ id }, 201);
    },
  ],
  [
    'PATCH',
    '/api/visits/:id',
    'owner',
    async (request, env, [id]) => {
      await db.saveVisit(env.DB, id, parseVisit(await readJson(request)), false);
      return json({ id });
    },
  ],
  [
    'DELETE',
    '/api/visits/:id',
    'owner',
    async (_request, env, [id]) => {
      await db.deleteVisit(env.DB, env.MEDIA, id);
      return json({ deleted: id });
    },
  ],
  [
    'POST',
    '/api/visits/:id/media',
    'owner',
    async (request, env, [visitId]) => {
      const form = await request.formData();
      const files = form.getAll('files').filter((value): value is File => value instanceof File);
      const ids = form.getAll('ids').map(String);
      if (!files.length || files.length > 4 || ids.length !== files.length)
        throw new HttpError(400, 'Upload 1–4 files with ids.');
      const uploads = await Promise.all(
        files.map(async (file, index) => ({
          id: uuid(ids[index]),
          name: file.name,
          type: file.type,
          bytes: new Uint8Array(await file.arrayBuffer()),
        })),
      );
      return json(await db.addMedia(env.DB, env.MEDIA, visitId, uploads), 201);
    },
  ],
  [
    'GET',
    '/api/media/:id/content',
    'public',
    async (_request, env, [id]) => db.openMedia(env.DB, env.MEDIA, id),
  ],
  [
    'PATCH',
    '/api/media/:id',
    'owner',
    async (request, env, [id]) => {
      await db.updateMediaCaption(
        env.DB,
        id,
        optionalString((await readJson(request)).caption, 'Caption', 160),
      );
      return json({ id });
    },
  ],
  [
    'DELETE',
    '/api/media/:id',
    'owner',
    async (_request, env, [id]) => {
      await db.deleteMedia(env.DB, env.MEDIA, id);
      return json({ deleted: id });
    },
  ],

  [
    'GET',
    '/api/google-ratings',
    'owner',
    async (_request, env) => json(await db.listGoogleRatings(env.DB)),
  ],
  [
    'POST',
    '/api/restaurants/:id/google-rating',
    'owner',
    async (_request, env, [id]) => {
      const { googlePlaceId } = await db.getRestaurant(env.DB, id);
      if (!googlePlaceId) throw new HttpError(409, 'This place has no matched Google place.');
      const rating = await fetchGoogleRating(env, googlePlaceId);
      if (!rating) throw new HttpError(503, 'Google ratings are unavailable right now.');
      await db.saveGoogleRating(env.DB, id, googlePlaceId, rating);
      return json(rating);
    },
  ],

  ['GET', '/api/settings/model', 'owner', async (_request, env) => json(await settingsStatus(env))],
  [
    'PUT',
    '/api/settings/model',
    'owner',
    async (request, env) => json(await saveSettings(env, await readJson(request, 8192))),
  ],
  [
    'DELETE',
    '/api/settings/model',
    'owner',
    async (_request, env) => json(await removeSettings(env)),
  ],

  // Add harness (see src/server/agent/add/http.ts for the contract).
  ...(['discover', 'select', 'confirm', 'cancel'] as const).map(
    (operation): [string, string, Access, Handler] => [
      'POST',
      `/api/catalog-intake/${operation}`,
      'owner',
      (request, env) => ownerAddResponse(request, env, operation),
    ],
  ),
  [
    'GET',
    '/api/catalog-intake/google-rating',
    'owner',
    async (request, env) => {
      const sessionId = new URL(request.url).searchParams.get('sessionId') ?? '';
      if (!/^[A-Za-z0-9_-]{10,128}$/u.test(sessionId)) throw new HttpError(400, 'Invalid session.');
      const conversationId = await ownerWebConversationId(request, env);
      const rating = await previewGoogleRating(env, sessionId, conversationId);
      if (rating === 'not_found') throw new HttpError(404, 'Preview not found.');
      return rating ? json(rating) : new Response(null, { status: 204 });
    },
  ],
  ['POST', '/api/agent/catalog-intake', 'self', agentAddResponse],
  ['GET', '/api/agent/capabilities', 'public', async () => json(AGENT_CAPABILITIES)],

  // Recommend harness.
  [
    'POST',
    '/api/recommend',
    'owner',
    async (request, env) => {
      const input = parseRecommendConversationInput(await readJson(request, 8192));
      if (!input) throw new HttpError(400, 'Valid query and replies are required.');
      try {
        return json(await createRecommendHarness(env).ask(input));
      } catch {
        return json(
          {
            status: 'unavailable',
            message: 'Recommendations are temporarily unavailable. Please retry.',
            retryable: true,
          },
          503,
        );
      }
    },
  ],
];

function parsePatch(body: Record<string, unknown>): RestaurantPatch {
  const flag = (value: unknown, field: string) => {
    if (value !== undefined && typeof value !== 'boolean')
      throw new HttpError(400, `Invalid ${field}.`);
    return value as boolean | undefined;
  };
  return {
    ...(body.title === undefined ? {} : { title: requiredString(body.title, 'Title', 200) }),
    ...(body.description === undefined
      ? {}
      : { description: optionalString(body.description, 'Description', 2000) ?? '' }),
    ...(body.rating === undefined ? {} : { rating: parseRating(body.rating) }),
    ...(body.comment === undefined
      ? {}
      : { comment: optionalString(body.comment, 'Comment', 4000) ?? null }),
    favorite: flag(body.favorite, 'favorite'),
    visited: flag(body.visited, 'visited'),
  };
}

function parseRating(value: unknown): number | null {
  if (value === null) return null;
  try {
    return normalizeRating(value as number);
  } catch {
    throw new HttpError(400, 'Rating must be a number from 0 to 10.');
  }
}

function parseVisit(body: Record<string, unknown>): VisitInput {
  return {
    restaurantId: requiredString(body.restaurantId, 'Restaurant', 200),
    visitedOn: isoDate(body.visitedOn, 'Visit date'),
    ...(optionalString(body.note, 'Note', 8000)
      ? { note: optionalString(body.note, 'Note', 8000) }
      : {}),
    ...(body.rating === undefined ? {} : { rating: parseRating(body.rating) }),
  };
}

const compiled = routes.map(([method, pattern, access, handler]) => ({
  method,
  access,
  handler,
  regex: new RegExp(`^${pattern.replace(/:id/gu, '([^/]+)')}$`, 'u'),
}));

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;
  const matches = compiled.filter((route) => route.regex.test(path));
  const route = matches.find((entry) => entry.method === request.method);
  if (!route) return json({ error: 'Not found.' }, matches.length ? 405 : 404);
  try {
    if (route.access === 'owner') await requireOwner(request, env);
    const params = (route.regex.exec(path) ?? []).slice(1).map(decodeURIComponent);
    return await route.handler(request, env, params);
  } catch (error) {
    return errorResponse(error);
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> | Response {
    if (new URL(request.url).pathname.startsWith('/api/')) return handleApi(request, env);
    return env.ASSETS?.fetch(request) ?? new Response('Not found', { status: 404 });
  },
  // Daily cleanup of expired Add sessions and the geocoder cache.
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await cleanupAddState(env.DB, new Date(controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
