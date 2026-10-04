import { liveAtlasBaseUrl } from '../live-config.mjs';
import { createServer } from 'node:http';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { recommendResponse } from '../../app/api/recommend/recommend-response.ts';
import { createRecommendConversationService } from '../../product/application/decision/recommend-conversation-service.ts';

// Serve the deployed UI locally to record its actual HTTP conversation. Fault
// scenarios replace only dependencies of the production application service.
// This is an evaluation process; it is never imported by the deployed app.
const upstream = liveAtlasBaseUrl();
const scenario = process.argv[2] ?? 'live';
if (
  !['live', 'empty-catalog', 'provider-failure', 'branch-choice'].includes(
    scenario,
  )
)
  throw new Error('Unknown acceptance scenario');
const port = Number(process.env.ATLAS_ACCEPTANCE_PORT ?? 4189);
const output =
  process.env.ATLAS_ACCEPTANCE_TRACE ??
  `evals/runs/release-current/browser-${scenario}.jsonl`;
const cookie =
  scenario === 'live'
    ? (await readFile(process.env.ATLAS_OWNER_COOKIE_FILE, 'utf8')).trim()
    : undefined;
await mkdir(dirname(output), { recursive: true });
const initialCatalog = await (await fetch(`${upstream}/api/items`)).json();
const catalog =
  scenario === 'empty-catalog'
    ? []
    : scenario === 'branch-choice'
      ? [
          ...initialCatalog,
          ...['新宿店', '銀座店'].map((branch, index) => ({
            ...initialCatalog[0],
            id: `fixture-origin-${index}`,
            title: `喫茶 みずき ${branch}`,
            area: branch.slice(0, -1),
            tags: ['コーヒー'],
            hasVisited: false,
            latitude: index === 0 ? 35.68805 : 35.67,
            longitude: index === 0 ? 139.71032 : 139.76,
          })),
        ]
      : initialCatalog;
let routeCalls = 0;
const controlledService = createRecommendConversationService({
  catalog: {
    async list() {
      return catalog;
    },
  },
  interpreter: {
    async interpret() {
      return {
        action: 'recommend',
        originId:
          scenario === 'branch-choice' ? 'place:fixture-origin-0' : null,
        ...(scenario === 'provider-failure'
          ? {
              originText: '銀座駅',
              originKind: 'station',
            }
          : {}),
        foodTerms: scenario === 'branch-choice' ? [] : ['sushi'],
        excludedFoodTerms: [],
        travelMode: scenario === 'provider-failure' ? 'walk' : 'none',
        maxMinutes: scenario === 'provider-failure' ? 10 : null,
        visited: 'any',
      };
    },
  },
  locationResolver: {
    async resolve() {
      return {
        status: 'resolved',
        location: {
          canonicalAddress: 'Controlled origin',
          point: { latitude: 35.671, longitude: 139.765 },
        },
        attribution: {
          label: 'Controlled fixture',
          url: 'https://example.com',
        },
      };
    },
  },
  routeProvider: {
    async walking() {
      routeCalls++;
      return { status: 'unavailable' };
    },
    async walkingMany() {
      routeCalls++;
      throw new Error('Injected route outage');
    },
  },
  clock: { now: () => new Date() },
});

function send(res, response, body) {
  res.writeHead(response.status, {
    'content-type':
      response.headers.get('content-type') ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, `http://127.0.0.1:${port}`);
    if (req.headers.host !== `127.0.0.1:${port}`) {
      res.writeHead(403).end();
      return;
    }
    if (req.method === 'POST' && path.pathname === '/api/recommend') {
      if (req.headers.origin !== `http://127.0.0.1:${port}`) {
        res.writeHead(403).end();
        return;
      }
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 8192) {
          res.writeHead(413).end();
          return;
        }
      }
      const startedAt = new Date().toISOString();
      const headers = { 'content-type': 'application/json', origin: upstream };
      if (cookie) headers.cookie = cookie;
      const response =
        scenario === 'live'
          ? await fetch(`${upstream}/api/recommend`, {
              method: 'POST',
              headers,
              body,
              signal: AbortSignal.timeout(45_000),
            })
          : await recommendResponse(
              new Request(`${upstream}/api/recommend`, {
                method: 'POST',
                headers,
                body,
              }),
              controlledService,
            );
      const text = await response.text();
      await appendFile(
        output,
        JSON.stringify({
          scenario,
          startedAt,
          request: JSON.parse(body),
          httpStatus: response.status,
          response: JSON.parse(text),
          routeCalls,
        }) + '\n',
      );
      send(res, response, text);
      return;
    }
    // Catalog writes and metered operations other than Recommend cannot reach
    // production through this recorder, including tools registered by the UI.
    if (req.method !== 'GET') {
      res.writeHead(405).end();
      return;
    }
    if (
      scenario === 'branch-choice' &&
      /^\/api\/items\/fixture-origin-[01]\/personal$/u.test(path.pathname)
    ) {
      const assessment = { favorite: false, effectiveVisited: false };
      send(res, Response.json(assessment), JSON.stringify(assessment));
      return;
    }
    if (scenario !== 'live' && path.pathname === '/api/auth/owner') {
      send(
        res,
        Response.json({ authenticated: true }),
        '{"authenticated":true}',
      );
      return;
    }
    if (path.pathname === '/api/items') {
      send(res, Response.json(catalog), JSON.stringify(catalog));
      return;
    }
    const headers =
      path.pathname === '/api/auth/owner' && cookie ? { cookie } : {};
    const response = await fetch(`${upstream}${path.pathname}${path.search}`, {
      headers,
      signal: AbortSignal.timeout(20_000),
      redirect: 'error',
    });
    send(res, response, Buffer.from(await response.arrayBuffer()));
  } catch {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('Acceptance dependency unavailable');
  }
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Acceptance ${scenario}: http://127.0.0.1:${port}`);
});
