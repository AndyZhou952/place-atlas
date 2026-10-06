import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseTabelogListing } from '../../apps/web/agent/tabelog-listing.ts';
import { createPlaceResearchAgent } from '../../apps/web/agent/place-research.ts';
import {
  formatOpeningHours,
  openingHoursPresentation,
} from '../../apps/web/product/application/catalog/operating-hours.ts';
import { validateEnrichedProfile } from '../../apps/web/product/application/catalog-intake/catalog-intake-coordinator.ts';

// Expectations are a literal oracle, independent of the formatter implementation.
const formatting = JSON.parse(
  await readFile(new URL('./operating-hours.v1.json', import.meta.url), 'utf8'),
);
assert.equal(formatting.schemaVersion, 1);
for (const sample of formatting.cases) {
  test(`opening-hours format: ${sample.id}`, () => {
    assert.equal(formatOpeningHours(sample.input), sample.expected);
    assert.equal(
      formatOpeningHours(sample.expected),
      sample.expected,
      'idempotence',
    );
    if (sample.presentation)
      assert.deepEqual(
        openingHoursPresentation(sample.input),
        sample.presentation,
      );
  });
}

test('formatting expansion at the 1200-character claim boundary preserves all facts', () => {
  const prefix = '金 18:00-2:00\n';
  const notePrefix = '臨時休業の際は事前告知します。';
  const note =
    notePrefix + '注'.repeat(1200 - prefix.length - notePrefix.length);
  const source = prefix + note;
  assert.equal(source.length, 1200);
  assert.equal(
    formatOpeningHours(source),
    source,
    'retain the full accepted source',
  );
  assert.equal(
    formatOpeningHours(formatOpeningHours(source)),
    source,
    'idempotence',
  );
  assert.deepEqual(openingHoursPresentation(source), {
    lines: ['金 18:00–翌02:00'],
    notes: [note],
  });
  assert.ok(
    validateEnrichedProfile({
      openingHours: {
        value: formatOpeningHours(source),
        sourceUrl: 'https://fixture.example/selected/hours',
        observedAt: '2026-09-22T10:00:00.000Z',
      },
    }),
    'formatted facts remain valid at the existing claim boundary',
  );
});

test('profile validation retains exact source wording until evidence grounding', () => {
  const sourceUrl = 'https://fixture.example/selected/hours';
  const observedAt = '2026-09-22T10:00:00.000Z';
  const checked = validateEnrichedProfile({
    openingHours: {
      value: '月・火・水・木・金 11:00 - 20:00',
      sourceUrl,
      observedAt,
    },
  });
  assert.deepEqual(checked.openingHours, {
    value: '月・火・水・木・金 11:00 - 20:00',
    sourceUrl,
    observedAt,
  });
});

const captures = {
  cases: [
    {
      id: 'dinner-with-weekend-lunch',
      name: 'Fixture Kitchen',
      listingUrl: 'https://tabelog.com/tokyo/A1317/A131701/13000001/',
      hoursRowHtml:
        '<p class="rstinfo-table__business-title">月・火・水・木・金</p><ul><li>17:00 - 23:00</li></ul><p class="rstinfo-table__business-title">土・日・祝日</p><ul><li>12:00 - 14:00 L.O. 13:00</li><li>17:00 - 22:00</li></ul><div>■ 定休日<br>年末年始</div>',
      expectedHoursIncludes: [
        '17:00 - 23:00',
        '12:00 - 14:00',
        'L.O. 13:00',
        '17:00 - 22:00',
      ],
      expectedClosingDays: null,
      expectedFormattedHours:
        '月〜金 17:00–23:00\n土・日・祝日 12:00–14:00 L.O. 13:00 / 17:00–22:00\n\n注意事項\n■ 定休日 年末年始',
    },
    {
      id: 'weekday-lunch',
      name: 'Fixture Noodles',
      listingUrl: 'https://tabelog.com/tokyo/A1317/A131701/13000002/',
      hoursRowHtml:
        '<p class="rstinfo-table__business-title">月・火・水・木・金</p><ul><li>08:15 - 14:30</li></ul><p class="rstinfo-table__business-title">土・日・祝日</p><ul><li>定休日</li></ul>',
      expectedHoursIncludes: ['08:15 - 14:30'],
      expectedClosingDays: '土・日・祝日',
      expectedFormattedHours: '月〜金 08:15–14:30\n土・日・祝日 定休日',
    },
    {
      id: 'daily-repeated-schedule',
      name: 'Fixture Daily Kitchen',
      listingUrl: 'https://tabelog.com/tokyo/A1317/A131701/13000003/',
      hoursRowHtml:
        '<p class="rstinfo-table__business-title">月</p><ul><li>11:00 - 22:00</li></ul><p class="rstinfo-table__business-title">火</p><ul><li>11:00 - 22:00</li></ul><p class="rstinfo-table__business-title">水</p><ul><li>11:00 - 22:00</li></ul><p class="rstinfo-table__business-title">木</p><ul><li>11:00 - 22:00</li></ul><p class="rstinfo-table__business-title">金</p><ul><li>11:00 - 22:00</li></ul><p class="rstinfo-table__business-title">土</p><ul><li>11:00 - 22:00</li></ul><p class="rstinfo-table__business-title">日・祝日</p><ul><li>11:00 - 22:00</li></ul>',
      expectedHoursIncludes: ['11:00 - 22:00'],
      expectedClosingDays: null,
      expectedFormattedHours: '毎日 11:00–22:00',
    },
  ],
};
function page(sample, row = sample.hoursRowHtml) {
  return `<script type="application/ld+json">${JSON.stringify({ '@type': 'Restaurant', '@id': sample.listingUrl, name: sample.name, address: { addressRegion: '東京都', addressLocality: '目黒区', streetAddress: '中目黒1-1-1' }, servesCuisine: 'イタリアン' })}</script><table><tr><th>営業時間</th><td>${row}</td></tr></table>`;
}
for (const sample of captures.cases) {
  test(`${sample.id}: hours preserve day differences, last order and explicit closures`, () => {
    const parsed = parseTabelogListing(
      page(sample),
      sample.listingUrl,
    ).restaurant;
    for (const phrase of sample.expectedHoursIncludes)
      assert.ok(parsed.openingHours.includes(phrase));
    assert.equal(
      parsed.regularClosingDays,
      sample.expectedClosingDays ?? undefined,
    );
    if (sample.id === 'dinner-with-weekend-lunch')
      assert.notEqual(parsed.regularClosingDays, '月');
  });
  test(`${sample.id}: verified business hours survive a model outage`, async (t) => {
    const observedAt = '2026-09-22T10:00:00.000Z';
    t.mock.timers.enable({ apis: ['Date'], now: new Date(observedAt) });
    const listing = parseTabelogListing(page(sample), sample.listingUrl);
    const agent = createPlaceResearchAgent({
      apiKey: 'fixture',
      baseUrl: 'https://model.example/v1',
      model: 'fixture',
      sourceReader: async () => ({ kind: 'read', evidence: listing }),
      fetch: async () => new Response('', { status: 503 }),
    });
    const result = await agent.research({
      selectedSubject: {
        providerNamespace: 'tabelog',
        placeId: sample.listingUrl,
        transientName: sample.name,
        transientAddress: listing.restaurant.address,
        ownerQuery: sample.name,
      },
    });
    assert.equal(result.kind, 'observed');
    assert.equal(
      result.value.profile.openingHours.value,
      sample.expectedFormattedHours,
    );
    assert.equal(
      result.value.profile.regularClosingDays?.value,
      sample.expectedClosingDays ?? undefined,
    );
    assert.equal(
      result.value.profile.openingHours.sourceUrl,
      sample.listingUrl,
    );
    assert.equal(result.value.profile.openingHours.observedAt, observedAt);
  });
}
test('review claims and missing rows cannot invent operating hours or a weekly closure', () => {
  const sample = captures.cases[0];
  const html = page(sample, '').replace(
    '<table>',
    '<p class="review">月曜日定休、12:00 - 23:00営業</p><table>',
  );
  const parsed = parseTabelogListing(html, sample.listingUrl).restaurant;
  assert.equal(parsed.openingHours, undefined);
  assert.equal(parsed.regularClosingDays, undefined);
});

test('model cannot turn a seasonal New Year closure into regularClosingDays', async () => {
  const sample = captures.cases.find(
    (entry) => entry.id === 'dinner-with-weekend-lunch',
  );
  const listing = parseTabelogListing(page(sample), sample.listingUrl);
  const quote = listing.content.includes('年末年始') ? '年末年始' : '';
  assert.ok(quote, 'fixture listing includes the seasonal closure note');
  const agent = createPlaceResearchAgent({
    apiKey: 'fixture',
    baseUrl: 'https://model.example/v1',
    model: 'fixture',
    sourceReader: async () => ({ kind: 'read', evidence: listing }),
    fetch: async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                subjectMatch: 'matched',
                tabelog: { status: 'unknown' },
                reservation: { status: 'unknown' },
                profile: {
                  openingHours: listing.restaurant.openingHours,
                  regularClosingDays: '年末年始',
                },
                evidence: {
                  openingHours: {
                    url: listing.url,
                    quote: listing.restaurant.openingHours,
                  },
                  regularClosingDays: { url: listing.url, quote },
                },
              }),
            },
          },
        ],
      }),
  });
  const result = await agent.research({
    selectedSubject: {
      providerNamespace: 'tabelog',
      placeId: sample.listingUrl,
      transientName: sample.name,
      transientAddress: listing.restaurant.address,
      ownerQuery: sample.name,
    },
  });
  assert.equal(result.kind, 'observed');
  assert.equal(
    result.value.profile.openingHours.value,
    sample.expectedFormattedHours,
  );
  assert.equal(result.value.profile.regularClosingDays, undefined);
});

test('official group JSON-LD can guide branch navigation but never supplies Japanese schedule fields', async () => {
  const listingUrl = 'https://tabelog.com/tokyo/A1317/A131701/13000001/';
  const groupUrl = 'https://kitchen.example/';
  const branchUrl = 'https://kitchen.example/selected';
  const branchAddress = '東京都目黒区中目黒1-1-1';
  const schedule = [
    {
      dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      opens: '17:00',
      closes: '23:00',
    },
    {
      dayOfWeek: ['Saturday', 'Sunday', 'PublicHolidays'],
      opens: '12:00',
      closes: '14:00',
    },
  ];
  const groupRecords = [
    {
      '@type': 'Restaurant',
      url: branchUrl,
      name: 'Fixture Kitchen',
      address: {
        addressRegion: '東京都',
        addressLocality: '目黒区',
        streetAddress: '中目黒1-1-1',
      },
      // Directory records may contain fields, but those fields are not facts
      // until the referenced branch page has itself been fetched and matched.
      openingHoursSpecification: schedule,
    },
    {
      '@type': 'Restaurant',
      url: 'https://kitchen.example/other',
      name: 'Fixture Kitchen',
      address: {
        addressRegion: '東京都',
        addressLocality: '渋谷区',
        streetAddress: '神南1-1-1',
      },
      openingHoursSpecification: [
        { dayOfWeek: ['Monday'], opens: '09:00', closes: '18:00' },
      ],
    },
  ];
  const branchHtml = `<title>Fixture Kitchen Nakameguro</title><p>Restaurant branch information.</p><script type="application/ld+json">${JSON.stringify({ '@type': 'Restaurant', url: branchUrl, name: 'Fixture Kitchen', address: { addressRegion: '東京都', addressLocality: '目黒区', streetAddress: '中目黒1-1-1' }, openingHoursSpecification: schedule })}</script>`;
  const listing = {
    url: listingUrl,
    title: 'Fixture Kitchen',
    content: `Fixture Kitchen ${branchAddress}`,
    restaurant: {
      name: 'Fixture Kitchen',
      address: branchAddress,
      area: '目黒区',
      categories: ['イタリアン'],
      officialWebsite: groupUrl,
    },
  };
  for (const variant of [
    'matching_refetched',
    'wrong_branch_only',
    'unfetched_hint',
  ]) {
    const fetched = [];
    const records =
      variant === 'wrong_branch_only' ? [groupRecords[1]] : groupRecords;
    const html = `<title>Restaurant Group</title><p>Restaurant group and its branch locations.</p><script type="application/ld+json">${JSON.stringify({ '@graph': records })}</script>`;
    const agent = createPlaceResearchAgent({
      apiKey: 'fixture',
      baseUrl: 'https://model.example/v1',
      model: 'fixture',
      sourceReader: async () => ({ kind: 'read', evidence: listing }),
      fetch: async (url) => {
        if (url === groupUrl)
          return new Response(html, {
            headers: { 'content-type': 'text/html' },
          });
        if (url === branchUrl) {
          fetched.push(url);
          return variant === 'unfetched_hint'
            ? new Response('', { status: 403 })
            : new Response(branchHtml, {
                headers: { 'content-type': 'text/html' },
              });
        }
        if (url === 'https://kitchen.example/other') {
          fetched.push(url);
          return new Response(branchHtml, {
            headers: { 'content-type': 'text/html' },
          });
        }
        return new Response('', { status: 503 });
      },
    });
    const result = await agent.research({
      selectedSubject: {
        providerNamespace: 'tabelog',
        placeId: listingUrl,
        transientName: 'Fixture Kitchen',
        transientAddress: branchAddress,
        ownerQuery: 'Fixture Kitchen Nakameguro',
      },
    });
    assert.equal(result.kind, 'observed', variant);
    if (variant === 'matching_refetched') {
      assert.deepEqual(fetched, [branchUrl]);
      assert.equal(result.value.profile.openingHours, undefined);
    } else {
      assert.deepEqual(
        fetched,
        variant === 'wrong_branch_only' ? [] : [branchUrl],
      );
      assert.equal(result.value.profile.openingHours, undefined, variant);
    }
  }
});

const first = captures.cases[0];
const facts = (row, extra = '') =>
  parseTabelogListing(page(first, row) + extra, first.listingUrl).restaurant;
const faq = (text, url = first.listingUrl) =>
  `<script type="application/ld+json">${JSON.stringify({ '@type': 'FAQPage', mainEntity: [{ name: '営業時間・定休日を教えてください', acceptedAnswer: { text: `${text} <a href="${url}">店舗情報</a>` } }] })}</script>`;

test('sister-branch advertising cannot replace selected weekly rows or closure notes', () => {
  const row =
    '<p class="rstinfo-table__business-title">月〜土</p><ul><li>17:00 - 22:30</li></ul><p class="rstinfo-table__business-title">日</p><ul><li>定休日</li></ul><div class="rstinfo-table__business-other">別支店 東京都渋谷区神南1-1-1 12:00 - 14:30 ■ 定休日 火曜日 年末年始休業</div>';
  const checked = facts(row);
  assert.match(checked.openingHours, /17:00 - 22:30/u);
  assert.doesNotMatch(checked.openingHours, /12:00|別支店/u);
  assert.equal(checked.regularClosingDays, '日');
  assert.equal(checked.closingNotes, undefined);
});

test('closure of a secondary facility keeps its scope', () => {
  const checked = facts(
    '月・火・水・木・金・土・日 10:00 - 18:00<br>2Fカフェサロン<br>■ 定休日<br>月曜日',
  );
  assert.equal(checked.regularClosingDays, '2Fカフェサロン：月曜日');
});

test('same-listing FAQ can qualify bare hours but cannot change clocks or branch identity', () => {
  const row = '11:00 - 20:00';
  assert.match(facts(row, faq('[月]11:00 - 20:00')).openingHours, /\[月\]/u);
  assert.equal(facts(row, faq('[月]11:00 - 21:00')).openingHours, row);
  assert.equal(
    facts(row, faq('[月]11:00 - 20:00', captures.cases[1].listingUrl))
      .openingHours,
    row,
  );
  assert.equal(facts(row).regularClosingDays, undefined);
});

test('structured days cannot be reassigned by a same-clock FAQ', () => {
  const row =
    '<p class="rstinfo-table__business-title">月</p><ul><li>11:00 - 20:00</li></ul><p class="rstinfo-table__business-title">火</p><ul><li>12:00 - 21:00</li></ul>';
  const checked = facts(row, faq('[月]12:00 - 21:00 [火]11:00 - 20:00'));
  assert.match(checked.openingHours, /月 11:00 - 20:00/u);
  assert.match(checked.openingHours, /火 12:00 - 21:00/u);
});

test('an explicit holiday exception remains separate from weekly closed rows', () => {
  const checked = facts(
    captures.cases[1].hoursRowHtml + '<br>祝日の場合は翌日が定休日となります',
  );
  assert.equal(
    checked.regularClosingDays,
    '土・日・祝日 / 祝日の場合は翌日が定休日となります',
  );
});
