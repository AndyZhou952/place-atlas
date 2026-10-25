// Add and Recommend benchmark. Prints one row per check and a summary.
//
//   npm run benchmark                     # stubbed sources and model: shows the format only
//   npm run benchmark -- --live           # real search, Tabelog (via Firecrawl) and model
//   npm run benchmark -- --live --json benchmarks/runs/<name>.json
//
// Live mode reads AGENT_API_KEY, AGENT_BASE_URL, AGENT_MODEL and optional FIRECRAWL_API_KEY,
// SEARCH_API_KEY and GOOGLE_PLACES_API_KEY from the environment. Save raw results only under
// the ignored benchmarks/runs/ directory.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { type AddSources, discover, preview } from '../apps/web/src/server/agent/add.ts';
import { recommend } from '../apps/web/src/server/agent/recommend.ts';
import { geocodeJapan } from '../apps/web/src/server/sources/geocode.ts';
import { classifyCuisines, prefectureOf } from '../apps/web/src/shared/cuisine.ts';
import type { Restaurant } from '../apps/web/src/shared/types.ts';
import {
  FULL_ROWS,
  chatResponse,
  firecrawlResponse,
  listingHtml,
  stubFetch,
  yahooHtml,
} from '../apps/web/test/fixtures.ts';

interface Check {
  readonly suite: string;
  readonly name: string;
  readonly check: string;
  readonly pass: boolean;
  readonly detail: string;
}

const cases = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8'));
const live = process.argv.includes('--live');
const jsonPath = process.argv[process.argv.indexOf('--json') + 1];
const env = process.env;
const model =
  env.AGENT_API_KEY && env.AGENT_BASE_URL && env.AGENT_MODEL
    ? { apiKey: env.AGENT_API_KEY, baseUrl: env.AGENT_BASE_URL, model: env.AGENT_MODEL }
    : undefined;
if (live && !model)
  throw new Error('Live mode needs AGENT_API_KEY, AGENT_BASE_URL and AGENT_MODEL.');

// Offline mode answers every request from stubs built from the case's own expectations, so all
// checks should pass: it verifies the pipeline and scoring end to end, not source or model quality.
const PREFECTURE_ADDRESS: Record<string, string> = {
  'JP-13': ['東京都', '渋谷区', '道玄坂1-1-1'].join('|'),
  'JP-26': '京都府|京都市東山区|祇園町1-1',
};
const CUISINE_LABEL: Record<string, string> = {
  'japanese.tonkatsu': 'とんかつ',
  'japanese.sushi': '寿司',
};
function offlineSources(expect: Record<string, string>, picks?: unknown): AddSources {
  const [addressRegion, addressLocality, streetAddress] = (
    PREFECTURE_ADDRESS[expect.prefecture] ?? PREFECTURE_ADDRESS['JP-13']
  ).split('|');
  const record = {
    name: `${expect.titleIncludes ?? 'テスト'} 本店`,
    address: { addressRegion, addressLocality, streetAddress },
    servesCuisine: CUISINE_LABEL[expect.cuisine] ?? 'ラーメン',
  };
  return {
    model: { apiKey: 'stub', baseUrl: 'https://model.test/v1', model: 'stub' },
    firecrawl: true,
    fetch: stubFetch({
      'https://search.yahoo.co.jp/': () =>
        new Response(yahooHtml(['https://tabelog.com/tokyo/A1317/A131701/13000001/'])),
      'https://api.firecrawl.dev/': async (request) => {
        const { url } = (await request.json()) as { url: string };
        return firecrawlResponse(url, listingHtml({ url, rows: FULL_ROWS, record }));
      },
      'https://model.test/': () => chatResponse(picks ?? { dishes: [], bookingNote: null }),
    }),
  };
}
const liveSources: AddSources = {
  model,
  searchKey: env.SEARCH_API_KEY,
  firecrawl: true,
  firecrawlKey: env.FIRECRAWL_API_KEY,
  googleKey: env.GOOGLE_PLACES_API_KEY,
};

const results: Check[] = [];
const record = (suite: string, name: string, check: string, pass: boolean, detail = '') =>
  results.push({ suite, name, check, pass, detail });

for (const testCase of cases.add) {
  const name = testCase.name;
  const started = Date.now();
  const sources = live ? liveSources : offlineSources(testCase.expect);
  try {
    const candidates = await discover(testCase.query, testCase.area, sources);
    record(
      'Add',
      name,
      'finds a candidate',
      candidates.length > 0,
      candidates.map((c) => c.name).join(' / '),
    );
    if (!candidates.length) continue;
    const { draft } = await preview(candidates[0], [], sources);
    const expect = testCase.expect;
    if (expect.titleIncludes)
      record('Add', name, 'title', draft.title.includes(expect.titleIncludes), draft.title);
    if (expect.prefecture)
      record(
        'Add',
        name,
        'prefecture',
        prefectureOf(draft.address) === expect.prefecture,
        draft.address,
      );
    if (expect.tabelogScore)
      record(
        'Add',
        name,
        'Tabelog score',
        draft.tabelog?.score !== undefined,
        String(draft.tabelog?.score),
      );
    if (expect.coordinates)
      record(
        'Add',
        name,
        'coordinates',
        draft.latitude !== null,
        `${draft.latitude}, ${draft.longitude}`,
      );
    if (expect.openingHours)
      record(
        'Add',
        name,
        'opening hours',
        Boolean(draft.openingHours),
        draft.openingHours?.slice(0, 40) ?? '',
      );
    if (expect.cuisine) {
      const cuisines = classifyCuisines(draft.categories);
      record(
        'Add',
        name,
        `cuisine ${expect.cuisine}`,
        cuisines.includes(expect.cuisine),
        draft.categories.join(', '),
      );
    }
    record(
      'Add',
      name,
      'reservation policy known',
      draft.reservation.policy !== 'unknown',
      draft.reservation.label.slice(0, 40),
    );
    record('Add', name, `time ${((Date.now() - started) / 1000).toFixed(1)}s`, true);
  } catch (error) {
    record(
      'Add',
      name,
      'runs without error',
      false,
      error instanceof Error ? error.message : String(error),
    );
  }
}

const catalog: Restaurant[] = cases.recommend.catalog.map((entry: Partial<Restaurant>) => ({
  description: '',
  cuisines: [],
  reservation: { policy: 'unknown', label: '' },
  addedAt: '2026-01-01',
  updatedAt: '2026-01-01',
  favorite: false,
  ...entry,
}));
for (const testCase of cases.recommend.cases) {
  const name = testCase.name;
  const expect = testCase.expect;
  const stubPicks = [expect.first, ...(expect.includes ?? [])]
    .filter(Boolean)
    .map((id) => ({ id, reason: 'stub' }));
  const sources = live
    ? liveSources
    : offlineSources({}, { origin: expect.origin ? '駅' : null, picks: stubPicks });
  try {
    const result = await recommend(testCase.request, catalog, {
      model: sources.model,
      fetch: sources.fetch,
      geocode: live
        ? (query) => geocodeJapan(query)
        : async () => ({ label: '駅', latitude: 35.69, longitude: 139.7 }),
    });
    const ids = result.picks.map((pick) => pick.id);
    const shown = ids.join(', ') || result.message || 'none';
    if (expect.first)
      record('Recommend', name, `first pick is ${expect.first}`, ids[0] === expect.first, shown);
    for (const id of expect.includes ?? [])
      record('Recommend', name, `includes ${id}`, ids.includes(id), shown);
    if (expect.excludes) {
      const wrong = ids.filter((id) => expect.excludes.includes(id));
      record('Recommend', name, 'excludes unrelated', !wrong.length, wrong.join(', '));
    }
    if (expect.origin)
      record(
        'Recommend',
        name,
        'origin resolved',
        Boolean(result.origin),
        result.origin?.label ?? '',
      );
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

const width = (key: keyof Check) =>
  Math.min(42, Math.max(...results.map((r) => String(r[key]).length), key.length));
console.log(
  `\nPlace Atlas benchmark — ${live ? 'LIVE sources and model' : 'offline (stubbed sources: checks plumbing and scoring only)'}\n`,
);
for (const r of results) {
  console.log(
    `${r.pass ? 'PASS' : 'FAIL'}  ${r.suite.padEnd(9)} ${r.name.padEnd(width('name'))} ${r.check.padEnd(width('check'))} ${r.detail}`,
  );
}
for (const suite of ['Add', 'Recommend']) {
  const own = results.filter((r) => r.suite === suite);
  console.log(`\n${suite}: ${own.filter((r) => r.pass).length}/${own.length} checks passed`);
}
if (jsonPath && process.argv.includes('--json')) {
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(
    jsonPath,
    JSON.stringify({ live, model: model?.model, at: new Date().toISOString(), results }, null, 2),
  );
}
if (!live && results.some((r) => !r.pass)) process.exitCode = 1;
