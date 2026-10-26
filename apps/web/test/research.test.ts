// Research agent boundaries with synthetic sources: branch identity, search recovery within the
// two-search budget, reported search causes, and reservation meaning.
import assert from 'node:assert/strict';
import test from 'node:test';
import { researchIssueMessage } from '../src/server/agent/add/workflow.ts';
import {
  createPlaceResearchAgent,
  resolveReservation,
} from '../src/server/agent/research/agent.ts';
import { explicitReservationMode } from '../src/server/agent/research/booking.ts';
import {
  initialResearchQuery,
  matchesSelectedBranch,
  simplerResearchQuery,
} from '../src/server/agent/research/branch-match.ts';
import { stubFetch } from './fixtures.ts';
import { createFirecrawlRestaurantReader } from '../src/server/agent/research/page-reader.ts';
import { readTabelogListingResult } from '../src/server/agent/research/tabelog-listing.ts';

// A short Japanese name at a single-number lot; Google and the listing use neighbouring postcodes.
const kyoto = {
  name: '合成',
  address: '日本、〒605-0001 京都府京都市東山区合成町367',
  query: '合成 祇園',
};
const listed = (overrides: Partial<{ name: string; address: string; postal: string }> = {}) => {
  const { name = '合成', address = '京都府京都市東山区合成町367', postal = '6050002' } = overrides;
  return matchesSelectedBranch(
    `${name} ${address}`,
    kyoto.name,
    kyoto.address,
    kyoto.query,
    address,
    postal,
    name,
  );
};

test('a short-name single-lot branch matches only when name, lot, ward, town and postcode area agree', () => {
  assert.equal(listed(), true);
  // A romanized provider name still matches through the whole word the Owner typed.
  assert.equal(
    matchesSelectedBranch(
      '合成 京都府京都市東山区合成町367',
      'Gosei',
      kyoto.address,
      kyoto.query,
      '京都府京都市東山区合成町367',
      '6050002',
      '合成',
    ),
    true,
  );
  assert.equal(listed({ address: '京都府京都市東山区合成町368' }), false, 'another lot');
  assert.equal(listed({ name: '合成食堂' }), false, 'another business at the same lot');
  assert.equal(listed({ address: '京都府京都市中京区合成町367' }), false, 'another ward');
  assert.equal(listed({ address: '京都府京都市東山区別町367' }), false, 'another town, same ward');
  assert.equal(listed({ address: '京都府京都市東山区西合成町367' }), false, 'a prefixed town');
  assert.equal(listed({ address: '京都府京都市東山区新合成町367' }), false, 'a prefixed town');
  assert.equal(listed({ address: '〒605-0002 京都府 京都市東山区 合成町367' }), true, 'spacing');
  assert.equal(listed({ address: '京都府京都市山科区別町367' }), false, 'another unmapped ward');
  assert.equal(listed({ address: '合成町367' }), false, 'no municipality on the listing');
  assert.equal(
    matchesSelectedBranch(
      '合成 京都府京都市東山区合成町367',
      kyoto.name,
      '日本、〒605-0001 京都府京都市東山区367',
      kyoto.query,
      '京都府京都市東山区合成町367',
      '6050002',
      '合成',
    ),
    false,
    'no town on the provider address',
  );
  assert.equal(listed({ postal: '1500001' }), false, 'postcodes in different areas');
  assert.equal(
    matchesSelectedBranch(
      '合成 京都府京都市東山区合成町367 2F',
      kyoto.name,
      '日本、〒605-0001 京都府京都市東山区合成町367 1F',
      kyoto.query,
      '京都府京都市東山区合成町367 2F',
      '6050001',
      '合成',
    ),
    false,
    'another floor',
  );
  // Without a lot number the identity is ambiguous and stays unmatched.
  assert.equal(
    matchesSelectedBranch(
      '合成 京都府京都市東山区合成町',
      kyoto.name,
      '日本、〒605-0001 京都府京都市東山区合成町',
      kyoto.query,
      '京都府京都市東山区合成町',
      '6050001',
      '合成',
    ),
    false,
  );
});

// A romanized provider address names its town in Latin script, which cannot be compared with the
// listing's kanji town; with only a prefecture, postal area, name and lot it stays unknown.
test('a romanized provider address never matches a single-lot listing on name, lot and area alone', () => {
  const fromRomanized = (address: string) =>
    matchesSelectedBranch(
      `合成 ${address}`,
      'Gosei',
      '367 Goseicho, Higashiyama Ward, Kyoto, 605-0001, Japan',
      '合成 京都',
      address,
      '6050002',
      '合成',
    );
  assert.equal(fromRomanized('京都府京都市東山区別町367'), false, 'another town');
  assert.equal(fromRomanized('京都府京都市山科区別町367'), false, 'another ward');
  assert.equal(fromRomanized('京都府京都市東山区合成町367'), false, 'uncorroborated town');
});

test('failed reads log the reader status apart from the page status, without the URL', async () => {
  const url = 'https://tabelog.com/tokyo/A1317/A131701/13999901/';
  const logged: unknown[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => logged.push(args);
  try {
    await createFirecrawlRestaurantReader({
      apiKey: 'test-key',
      fetch: stubFetch({ 'https://api.firecrawl.dev/': () => new Response('', { status: 521 }) }),
    })(url, AbortSignal.timeout(1000));
    await createFirecrawlRestaurantReader({
      apiKey: 'test-key',
      fetch: stubFetch({
        'https://api.firecrawl.dev/': () =>
          Response.json({ success: true, data: { rawHtml: '', metadata: { statusCode: 403 } } }),
      }),
    })(url, AbortSignal.timeout(1000));
    await readTabelogListingResult(
      url,
      stubFetch({ 'https://tabelog.com/': () => new Response('', { status: 403 }) }),
      AbortSignal.timeout(1000),
    );
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(logged, [
    ['provider_call', { provider: 'firecrawl', resultClass: 'unavailable', status: 521 }],
    [
      'provider_call',
      { provider: 'firecrawl', resultClass: 'blocked', status: 200, sourceStatus: 403 },
    ],
    ['provider_call', { provider: 'tabelog', resultClass: 'blocked', sourceStatus: 403 }],
  ]);
  assert.doesNotMatch(JSON.stringify(logged), /tabelog\.com/u);
});

test('reservation meaning: takeaway exceptions do not decide the dine-in rule', () => {
  assert.equal(
    explicitReservationMode('予約不可 ※テイクアウトの「合成弁当」のみ電話予約可。朝8時より。'),
    'not_reservable',
  );
  for (const refusal of [
    'not reservable',
    'No reservations accepted',
    'Reservations are not accepted',
  ])
    assert.equal(explicitReservationMode(refusal), 'not_reservable', refusal);
  assert.equal(explicitReservationMode('Reservations accepted'), 'reservable');
  assert.equal(explicitReservationMode('予約不可 ※テイクアウトのみ電話予約可'), 'not_reservable');
  assert.equal(explicitReservationMode('完全予約制'), 'reservation_required');
  assert.equal(explicitReservationMode('予約可否 予約可'), 'reservable');
  assert.equal(explicitReservationMode('予約可 / 予約不可'), 'conflict');
  assert.equal(explicitReservationMode('営業時間 11:00〜22:00'), undefined);
  const known = (mode: string, url: string) => ({ status: 'known', mode, url });
  const listing = known('not_reservable', 'https://tabelog.com/kyoto/A2601/A260301/26000001/');
  // A verified official page wins; any other disagreement stays unknown.
  assert.equal(
    resolveReservation(
      known('reservable', 'https://gosei.example/reserve'),
      listing,
      'https://gosei.example/',
    ).mode,
    'reservable',
  );
  assert.equal(
    resolveReservation(
      known('reservable', 'https://blog.example/post'),
      listing,
      'https://gosei.example/',
    ).status,
    'unknown',
  );
});

// The selected branch for the agent runs: a dictated query with building text and block numbers.
const LISTING = 'https://tabelog.com/tokyo/A1317/A131701/13999901/';
const subject = {
  ownerQuery: 'ごうせいしょくどう なかめぐろ',
  providerNamespace: 'google-places',
  placeId: 'ChIJsyntheticPlace002',
  transientName: '合成食堂 中目黒',
  transientAddress: '日本、〒153-0061 東京都目黒区中目黒1-2-3 合成ビル 2F',
};
const takeawayOnly = '予約不可 ※テイクアウトのみ電話予約可';
const listingAt = (
  address: string,
  postalCode: string,
  policy: string,
  name = '合成食堂 中目黒',
) => ({
  name,
  address,
  postalCode,
  area: '',
  score: 3.51,
  categories: ['定食'],
  reservation: policy,
  coordinates: { latitude: 35.0, longitude: 135.77 },
});
const reader = (restaurant: ReturnType<typeof listingAt>) => async (url: string) =>
  url === LISTING
    ? {
        kind: 'read' as const,
        evidence: {
          url: LISTING,
          title: `${restaurant.name} - 食べログ`,
          content: `${restaurant.name} ${restaurant.address} 予約可否 ${restaurant.reservation}`,
          restaurant,
        },
      }
    : { kind: 'unavailable' as const };
const yahoo = (rows: string) =>
  new Response(`<html><body><div id="web"><ol>${rows}</ol></div></body></html>`, {
    headers: { 'content-type': 'text/html' },
  });
const listingRow = `<li><a href="${LISTING}">合成食堂 中目黒 - 食べログ</a><div>東京都目黒区中目黒1-2-3</div></li>`;

function agentRun(options: {
  readonly search: (query: string) => Response;
  readonly answer: unknown;
  readonly policy?: string;
  readonly subject?: typeof subject;
  readonly listing?: ReturnType<typeof listingAt>;
}) {
  const queries: string[] = [];
  let modelCalls = 0;
  const agent = createPlaceResearchAgent({
    apiKey: 'test-key',
    baseUrl: 'https://model.test/v1',
    model: 'test-model',
    sourceReader: reader(
      options.listing ??
        listingAt('東京都目黒区中目黒1-2-3 合成ビル 2F', '1530061', options.policy ?? takeawayOnly),
    ),
    fetch: stubFetch({
      'https://search.yahoo.co.jp/search': (request) => {
        const query = new URL(request.url).searchParams.get('p') ?? '';
        queries.push(query);
        return options.search(query);
      },
      // The public fallback is challenged throughout.
      'https://html.duckduckgo.com/html': () => new Response('', { status: 202 }),
      'https://model.test/v1/chat/completions': () => {
        modelCalls++;
        return Response.json({
          choices: [{ message: { content: JSON.stringify(options.answer) } }],
        });
      },
    }),
  });
  return {
    run: () => agent.research({ phase: 'initial', selectedSubject: options.subject ?? subject }),
    queries,
    modelCalls: () => modelCalls,
  };
}

test('a zero-result first search spends the second search on the simpler name and area query', async () => {
  const first = initialResearchQuery(subject);
  const simpler = simplerResearchQuery(subject);
  assert.notEqual(first, simpler);
  const research = agentRun({
    search: (query) => (query === simpler ? yahoo(listingRow) : yahoo('')),
    answer: {
      subjectMatch: 'matched',
      tabelog: { status: 'unknown' },
      reservation: { status: 'unknown' },
    },
  });
  const result = await research.run();
  assert.deepEqual(research.queries, [first, simpler]);
  assert.equal(result.kind, 'observed');
  if (result.kind !== 'observed') return;
  assert.equal(result.sourceAccessIssue, undefined);
  assert.equal(result.value.tabelog.status === 'known' && result.value.tabelog.score, 3.51);
  assert.equal(
    result.value.reservation.status === 'known' && result.value.reservation.mode,
    'not_reservable',
  );
});

test('a model reservation mode that contradicts the quoted dine-in rule is not accepted', async () => {
  const research = agentRun({
    search: () => yahoo(listingRow),
    answer: {
      subjectMatch: 'matched',
      tabelog: { status: 'unknown' },
      reservation: {
        status: 'known',
        mode: 'reservation_required',
        label: '電話予約',
        url: LISTING,
      },
      evidence: {
        reservation: {
          url: LISTING,
          quote: '予約不可 ※テイクアウトのみ電話予約可',
          identityQuote: '合成食堂 中目黒 東京都目黒区中目黒1-2-3',
        },
      },
    },
  });
  const result = await research.run();
  assert.equal(research.queries.length, 1);
  assert.equal(result.kind, 'observed');
  if (result.kind !== 'observed') return;
  // The listing's own explicit rule replaces the contradicted claim.
  assert.equal(
    result.value.reservation.status === 'known' && result.value.reservation.mode,
    'not_reservable',
  );
});

test('refused searches are reported as a search failure, not as a missing restaurant', async () => {
  const research = agentRun({
    search: () => new Response('', { status: 202 }),
    answer: { subjectMatch: 'uncertain' },
  });
  const result = await research.run();
  assert.equal(research.queries.length, 2, 'two searches, no hidden third');
  assert.ok(research.modelCalls() <= 3);
  assert.equal(result.kind, 'observed');
  if (result.kind !== 'observed') return;
  assert.equal(result.sourceAccessIssue, 'search_blocked');
  assert.equal(result.value.tabelog.status, 'unknown');
  const message = researchIssueMessage('search_blocked', false);
  assert.match(message, /web search service refused/u);
  assert.doesNotMatch(message, /Tabelog refused|no rating/u);
  assert.match(researchIssueMessage('no_listing', false), /no Tabelog listing that matches/u);
});

test('a sourced refusal with a quoted takeaway item stays known as not reservable', async () => {
  const policy = '予約不可 ※テイクアウトの「合成弁当」のみ電話予約可。朝8時より。';
  const research = agentRun({
    search: () => yahoo(listingRow),
    policy,
    answer: {
      subjectMatch: 'matched',
      tabelog: { status: 'unknown' },
      reservation: { status: 'known', mode: 'not_reservable', label: '予約不可', url: LISTING },
      evidence: {
        reservation: {
          url: LISTING,
          quote: policy,
          identityQuote: '合成食堂 中目黒 東京都目黒区中目黒1-2-3',
        },
      },
    },
  });
  const result = await research.run();
  assert.equal(result.kind, 'observed');
  if (result.kind !== 'observed') return;
  assert.equal(
    result.value.reservation.status === 'known' && result.value.reservation.mode,
    'not_reservable',
  );
});

test('a listing at another town contributes no rating, address, coordinates or reservation', async () => {
  const romanized = '367 Goseicho, Higashiyama Ward, Kyoto, 605-0001, Japan';
  const japanese = '日本、〒605-0001 京都府京都市東山区合成町367';
  for (const [selected, address, known] of [
    [romanized, '京都府京都市山科区別町367', false],
    [japanese, '京都府京都市東山区西合成町367', false],
    [japanese, '京都府京都市東山区合成町367', true],
  ] as const) {
    const research = agentRun({
      subject: {
        ...subject,
        ownerQuery: '合成 京都',
        transientName: '合成',
        transientAddress: selected,
      },
      listing: listingAt(address, '6050002', '予約可', '合成'),
      search: () => yahoo(`<li><a href="${LISTING}">合成 - 食べログ</a><div>${address}</div></li>`),
      answer: {
        subjectMatch: 'uncertain',
        tabelog: { status: 'known', score: 3.51, url: LISTING },
        reservation: { status: 'known', mode: 'reservable', label: '予約可', url: LISTING },
        profile: { address },
        evidence: {
          tabelog: { url: LISTING, quote: '3.51', identityQuote: `合成 ${address}` },
          reservation: { url: LISTING, quote: '予約可否 予約可', identityQuote: `合成 ${address}` },
          address: { url: LISTING, quote: address, identityQuote: `合成 ${address}` },
        },
      },
    });
    const result = await research.run();
    assert.equal(result.kind, 'observed');
    if (result.kind !== 'observed') return;
    // The exact same-town listing is the control: the same claims are accepted there.
    assert.equal(result.value.tabelog.status, known ? 'known' : 'unknown', address);
    if (known) continue;
    assert.equal(result.value.reservation.status, 'unknown', address);
    assert.equal(result.value.profile?.address, undefined, address);
    assert.equal(result.value.profile?.coordinates, undefined, address);
  }
});
