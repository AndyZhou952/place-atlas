// Add and Recommend benchmark over the production harness. Prints one row per check.
//
//   npm run benchmark                    # offline: Recommend with recorded interpretations
//   npm run benchmark -- --live          # live Add (Google Places/Tabelog/Nominatim/model) and Recommend
//   npm run benchmark -- --live --json ../../benchmarks/runs/<name>.json
//   npm run benchmark -- --live --repeat 3    # every live Add case three times, each attempt reported
//
// Live mode reads AGENT_API_KEY, AGENT_BASE_URL and AGENT_MODEL, plus optional SEARCH_API_KEY,
// FIRECRAWL_API_KEY (with RESTAURANT_SOURCE_READER=firecrawl), GOOGLE_PLACES_API_KEY (with
// CATALOG_INTAKE_GOOGLE_PLACES_MODE=enabled) and GOOGLE_MAPS_API_KEY for route times. Save raw
// results only under the ignored benchmarks/runs/ directory.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createAddHarness } from '../apps/web/src/server/agent/add/compose.ts';
import { executeCatalogIntake } from '../apps/web/src/server/agent/add/workflow.ts';
import { createRecommendHarness } from '../apps/web/src/server/agent/recommend/compose.ts';
import type { RouteSidecarServiceBinding } from '../apps/web/src/server/agent/recommend/routes.ts';
import type { Env } from '../apps/web/src/server/env.ts';
import { createGoogleRouteSidecarService } from '../apps/web/route-sidecar/google.ts';
import { GOOGLE_ROUTE_SIDECAR_ATTRIBUTION } from '../apps/web/route-sidecar/contract.ts';
import type {
  CatalogIntakeDiscoverOutput,
  CatalogIntakeSelectOutput,
} from '../apps/web/src/shared/catalog-intake.ts';
import { classifyCuisines, prefectureOf } from '../apps/web/src/shared/cuisine.ts';
import { migratedD1 } from '../apps/web/test/fixtures.ts';

interface Check {
  readonly suite: string;
  readonly name: string;
  readonly check: string;
  readonly pass: boolean;
  readonly detail: string;
}

const cases = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8'));
const live = process.argv.includes('--live');
const jsonPath = process.argv.includes('--json')
  ? process.argv[process.argv.indexOf('--json') + 1]
  : undefined;
const repeat = process.argv.includes('--repeat')
  ? Math.max(1, Math.min(10, Number(process.argv[process.argv.indexOf('--repeat') + 1]) || 1))
  : 1;
const vars = process.env;
if (live && !(vars.AGENT_API_KEY && vars.AGENT_BASE_URL && vars.AGENT_MODEL))
  throw new Error('Live mode needs AGENT_API_KEY, AGENT_BASE_URL and AGENT_MODEL.');

const results: Check[] = [];
const record = (suite: string, name: string, check: string, pass: boolean, detail = '') =>
  results.push({ suite, name, check, pass, detail });
// Provider warnings go to the Worker log in production; keep the report readable here.
console.info = () => undefined;
console.warn = () => undefined;

function environment(db: D1Database, routes?: RouteSidecarServiceBinding): Env {
  return {
    DB: db,
    MEDIA: {} as R2Bucket,
    ...(routes ? { ROUTE_SIDECAR: routes } : {}),
    ...(live
      ? {
          AGENT_API_KEY: vars.AGENT_API_KEY,
          AGENT_BASE_URL: vars.AGENT_BASE_URL,
          AGENT_MODEL: vars.AGENT_MODEL,
          SEARCH_API_KEY: vars.SEARCH_API_KEY,
          RESTAURANT_SOURCE_READER: vars.RESTAURANT_SOURCE_READER,
          FIRECRAWL_API_KEY: vars.FIRECRAWL_API_KEY,
          GOOGLE_PLACES_API_KEY: vars.GOOGLE_PLACES_API_KEY,
          CATALOG_INTAKE_GOOGLE_PLACES_MODE: vars.CATALOG_INTAKE_GOOGLE_PLACES_MODE,
          CATALOG_INTAKE_DURABLE_GEOCODER_MODE: 'enabled',
        }
      : // Offline, the model "answers" with each case's recorded interpretation.
        { AGENT_API_KEY: 'offline', AGENT_BASE_URL: 'https://api.deepseek.com', AGENT_MODEL: 'x' }),
  };
}

// Add: discover → select the first match (with agent research) → check the preview.

async function runAdd(testCase: {
  name: string;
  query: string;
  area?: string;
  expect: Record<string, string | boolean>;
}) {
  const { name, expect } = testCase;
  // The same request the Add panel sends: the name plus the optional area or branch.
  const query = [testCase.query, testCase.area].filter(Boolean).join(' ');
  const started = Date.now();
  const harness = createAddHarness(environment(migratedD1().db));
  const scope = { ownerId: 'owner', channel: 'web', conversationId: 'b'.repeat(32) };
  const discovered = await executeCatalogIntake(
    harness,
    'discover',
    { query, requestToken: crypto.randomUUID() },
    scope,
  );
  const candidates = discovered.ok ? (discovered.value as CatalogIntakeDiscoverOutput) : undefined;
  record(
    'Add',
    name,
    'finds a candidate',
    Boolean(candidates?.candidates.length),
    candidates
      ? candidates.candidates.map((candidate) => candidate.transientName).join(' / ')
      : discovered.ok
        ? ''
        : discovered.error.message,
  );
  if (!candidates?.candidates.length) return;
  const selected = await executeCatalogIntake(
    harness,
    'select',
    {
      sessionId: candidates.sessionId,
      expectedSessionVersion: candidates.sessionVersion,
      ordinal: 1,
      requestResearch: true,
    },
    scope,
  );
  const output = selected.ok ? (selected.value as CatalogIntakeSelectOutput) : undefined;
  if (output?.status !== 'preview_ready') {
    record(
      'Add',
      name,
      'builds a preview',
      false,
      selected.ok ? output?.status : selected.error.message,
    );
    return;
  }
  const preview = output.preview;
  const title = preview.ownerFields.title ?? preview.titleProposal?.value ?? '';
  const address = preview.addressProposal?.value ?? '';
  const categories = preview.profile?.categories?.value ?? [];
  const checks: [string, boolean, string][] = [];
  if (expect.titleIncludes)
    checks.push(['title', title.includes(String(expect.titleIncludes)), title]);
  if (expect.prefecture)
    checks.push(['prefecture', prefectureOf(address) === expect.prefecture, address]);
  if (expect.coordinates) {
    const location = preview.locationEvidence;
    checks.push([
      'coordinates',
      location.status === 'known',
      location.status === 'known' ? `${location.latitude}, ${location.longitude}` : 'unknown',
    ]);
  }
  if (expect.tabelogScore)
    checks.push([
      'Tabelog score',
      preview.tabelog.status === 'known',
      preview.tabelog.status === 'known' ? String(preview.tabelog.score) : 'unknown',
    ]);
  if (expect.openingHours)
    checks.push([
      'opening hours',
      Boolean(preview.profile?.openingHours),
      preview.profile?.openingHours?.value.slice(0, 40) ?? '',
    ]);
  if (expect.cuisine)
    checks.push([
      `cuisine ${expect.cuisine}`,
      classifyCuisines(categories).includes(String(expect.cuisine)),
      categories.join(', '),
    ]);
  checks.push([
    'reservation known',
    preview.reservation.status === 'known',
    preview.reservation.status === 'known' ? preview.reservation.label.slice(0, 40) : 'unknown',
  ]);
  // A failed check carries the research warning the Owner would see.
  const warning = preview.warnings.find(({ code }) => code === 'provider_unavailable')?.message;
  for (const [check, pass, detail] of checks)
    record('Add', name, check, pass, pass || !warning ? detail : `${detail} — ${warning}`);
  record('Add', name, `time ${((Date.now() - started) / 1000).toFixed(1)}s`, true);
}

// Recommend: a small fictional catalog; offline, a fixed place table stands in for geocoding.

function fixedRoutes(places: Record<string, [number, number]>): RouteSidecarServiceBinding {
  const source = { providerId: 'google-maps-platform' as const, endpoint: 'offline' };
  const checkedAt = () => new Date().toISOString();
  return {
    async geocode({ locationHint }) {
      const point = places[locationHint.trim()];
      return point
        ? {
            ok: true,
            evidence: {
              candidates: [
                {
                  formattedAddress: locationHint,
                  point: { latitude: point[0], longitude: point[1] },
                },
              ],
              attribution: GOOGLE_ROUTE_SIDECAR_ATTRIBUTION,
              source,
              checkedAt: checkedAt(),
            },
          }
        : { ok: false, error: 'dependency_failure' };
    },
    async walkingMatrix() {
      return { ok: false, error: 'not_configured' };
    },
  };
}

function seedCatalog(sqlite: ReturnType<typeof migratedD1>['sqlite']) {
  const insert = sqlite.prepare(
    `INSERT INTO atlas_items (id, payload_json, verification_status, created_at, updated_at)
     VALUES (?, ?, 'verified', '2026-01-01', '2026-01-01')`,
  );
  const assess = sqlite.prepare(
    `INSERT INTO place_assessments (item_id, overall_rating, has_visited, created_at, updated_at)
     VALUES (?, ?, ?, '2026-01-01', '2026-01-01')`,
  );
  for (const entry of cases.recommend.catalog) {
    const { visited, rating, ...item } = entry;
    insert.run(
      item.id,
      JSON.stringify({
        kind: 'food',
        description: '',
        verificationStatus: 'verified',
        verifiedAt: '2026-01-01T00:00:00.000Z',
        reservation: { mode: 'unknown', label: '' },
        personalState: 'saved',
        sources: [],
        ...item,
      }),
    );
    if (visited || rating !== undefined) assess.run(item.id, rating ?? null, visited ? 1 : 0);
  }
}

async function runRecommend(testCase: {
  name: string;
  request: string;
  interpretation: unknown;
  expect: { status?: string; first?: string; includes?: string[]; excludes?: string[] };
}) {
  const { name, request, interpretation, expect } = testCase;
  const { db, sqlite } = migratedD1();
  seedCatalog(sqlite);
  const routes =
    live && vars.GOOGLE_MAPS_API_KEY
      ? createGoogleRouteSidecarService({
          apiKey: vars.GOOGLE_MAPS_API_KEY,
          clock: () => new Date(),
          fetch: (url, init) => fetch(url, init),
        })
      : live
        ? undefined
        : fixedRoutes(cases.recommend.places);
  const modelStub: typeof fetch = async () =>
    Response.json({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(interpretation) } }],
    });
  try {
    const result = await createRecommendHarness(
      environment(db, routes),
      live ? fetch : modelStub,
    ).ask({ query: request, replies: [] });
    const ids =
      result.status === 'recommend' ? result.recommendations.map((item) => item.itemId) : [];
    const shown =
      result.status === 'recommend'
        ? ids.join(', ')
        : `${result.status}: ${'question' in result ? result.question : 'message' in result ? result.message : ''}`;
    if (expect.status)
      record('Recommend', name, `answers ${expect.status}`, result.status === expect.status, shown);
    if (expect.first)
      record('Recommend', name, `first pick is ${expect.first}`, ids[0] === expect.first, shown);
    for (const id of expect.includes ?? [])
      record('Recommend', name, `includes ${id}`, ids.includes(id), shown);
    if (expect.excludes) {
      const wrong = ids.filter((id) => expect.excludes!.includes(id));
      record('Recommend', name, 'excludes unrelated', !wrong.length, wrong.join(', ') || shown);
    }
  } catch (error) {
    record(
      'Recommend',
      name,
      'runs without error',
      false,
      error instanceof Error ? error.message : String(error),
    );
  }
}

if (live)
  for (const testCase of cases.add)
    for (let attempt = 1; attempt <= repeat; attempt++)
      await runAdd(repeat > 1 ? { ...testCase, name: `${testCase.name} #${attempt}` } : testCase);
for (const testCase of cases.recommend.cases) await runRecommend(testCase);

const width = (key: keyof Check) =>
  Math.min(42, Math.max(...results.map((r) => String(r[key]).length), key.length));
console.log(
  `\nPlace Atlas benchmark — ${live ? 'LIVE providers and model' : 'offline (recorded interpretations; Add needs --live)'}\n`,
);
for (const r of results)
  console.log(
    `${r.pass ? 'PASS' : 'FAIL'}  ${r.suite.padEnd(9)} ${r.name.padEnd(width('name'))} ${r.check.padEnd(width('check'))} ${r.detail}`,
  );
for (const suite of ['Add', 'Recommend']) {
  const own = results.filter((r) => r.suite === suite);
  if (own.length)
    console.log(`\n${suite}: ${own.filter((r) => r.pass).length}/${own.length} checks passed`);
}
if (jsonPath) {
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(
    jsonPath,
    JSON.stringify(
      { live, model: live ? vars.AGENT_MODEL : undefined, at: new Date().toISOString(), results },
      null,
      2,
    ),
  );
}
// Any failed check fails the run, offline or live.
if (results.some((r) => !r.pass)) process.exitCode = 1;
