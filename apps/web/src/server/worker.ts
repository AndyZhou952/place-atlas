import { normalizeRating } from '../shared/text.ts';
import type { RestaurantPatch, VisitInput } from '../shared/types.ts';
import { type AddSources, discover, parseDraft, preview, findDuplicates } from './agent/add.ts';
import { recommend } from './agent/recommend.ts';
import { isOwner, login, logout, requireOwner, requireOwnerOrAddAgent } from './auth.ts';
import * as db from './db.ts';
import { type Env, googleKey } from './env.ts';
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
import { toPayload } from './record.ts';
import { modelConfig, removeSettings, saveSettings, settingsStatus } from './settings.ts';
import { geocodeJapan } from './sources/geocode.ts';
import { getGoogleRating } from './sources/google.ts';

type Handler = (request: Request, env: Env, params: string[]) => Promise<Response>;
type Access = 'public' | 'owner' | 'add';

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
      const key = googleKey(env);
      const { googlePlaceId } = await db.getRestaurant(env.DB, id);
      if (!key || !googlePlaceId)
        throw new HttpError(409, 'Google ratings need a Google Places key and a matched place.');
      const rating = await getGoogleRating(key, googlePlaceId);
      if (!rating) throw new HttpError(502, 'Google returned no rating for this place.');
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

  [
    'POST',
    '/api/add/search',
    'add',
    async (request, env) => {
      const body = await readJson(request);
      return json(
        await discover(
          requiredString(body.query, 'Query', 500),
          optionalString(body.area, 'Area', 200),
          await addSources(env),
        ),
      );
    },
  ],
  [
    'POST',
    '/api/add/preview',
    'add',
    async (request, env) => {
      const body = await readJson(request);
      const candidate = {
        source: requiredString(body.source, 'Source', 20),
        ref: requiredString(body.ref, 'Reference', 500),
      };
      return json(
        await preview(candidate, await db.listRestaurants(env.DB), await addSources(env)),
      );
    },
  ],
  [
    'POST',
    '/api/add/save',
    'add',
    async (request, env) => {
      const draft = parseDraft((await readJson(request)).draft);
      const same = findDuplicates(draft, await db.listRestaurants(env.DB)).find(
        (entry) => entry.match === 'same' && entry.id !== draft.id,
      );
      if (same) throw new HttpError(409, `${same.title} is already saved.`);
      const now = new Date().toISOString();
      await db.insertRestaurant(env.DB, draft.id, toPayload(draft, now), now);
      return json({ id: draft.id }, 201);
    },
  ],
  ['GET', '/api/add', 'public', async () => json(ADD_API_DESCRIPTION)],

  [
    'POST',
    '/api/recommend',
    'owner',
    async (request, env) => {
      const query = requiredString((await readJson(request)).query, 'Request', 1000);
      const contact = env.ATLAS_PUBLIC_URL;
      return json(
        await recommend(query, await db.listRestaurants(env.DB), {
          model: await modelConfig(env),
          geocode: (text) => geocodeJapan(text, contact),
        }),
      );
    },
  ],
];

const ADD_API_DESCRIPTION = {
  description:
    'Add a restaurant in Japan. Authenticate with `Authorization: Bearer <ATLAS_ADD_AGENT_TOKEN>`.',
  steps: [
    'POST /api/add/search {query, area?} → candidates [{source, ref, name, address, score?}]',
    'POST /api/add/preview {source, ref} → {draft, duplicates, notes}; show the draft to a human for review',
    'POST /api/add/save {draft} → {id}; repeat with the same draft.id to retry safely',
  ],
};

async function addSources(env: Env): Promise<AddSources> {
  return {
    searchKey: env.SEARCH_API_KEY,
    firecrawl: env.RESTAURANT_SOURCE_READER === 'firecrawl',
    firecrawlKey: env.FIRECRAWL_API_KEY,
    googleKey: googleKey(env),
    model: await modelConfig(env).catch(() => undefined),
  };
}

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
    if (route.access === 'add') await requireOwnerOrAddAgent(request, env);
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
} satisfies ExportedHandler<Env>;
