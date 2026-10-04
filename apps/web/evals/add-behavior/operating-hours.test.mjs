import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseTabelogListing } from '../../agent/tabelog-listing.ts';
import { createPlaceResearchAgent } from '../../agent/place-research.ts';
import { scoreRestaurantHours } from './restaurant-hours-score.mjs';

const captures = JSON.parse(
  readFileSync(
    new URL('./operating-hours-captures.v1.json', import.meta.url),
    'utf8',
  ),
);
function page(sample, row = sample.hoursRowHtml) {
  return `<script type="application/ld+json">${JSON.stringify({ '@type': 'Restaurant', '@id': sample.listingUrl, name: sample.name, address: { addressRegion: '東京都', addressLocality: '目黒区', streetAddress: '中目黒3-5-1' }, servesCuisine: 'イタリアン' })}</script><table><tr><th>営業時間</th><td>${row}</td></tr></table>`;
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
    if (sample.id === 'rodeo') assert.notEqual(parsed.regularClosingDays, '月');
  });
  test(`${sample.id}: verified business hours survive a model outage`, async () => {
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
      listing.restaurant.openingHours,
    );
    assert.equal(
      result.value.profile.regularClosingDays?.value,
      sample.expectedClosingDays ?? undefined,
    );
    assert.equal(
      result.value.profile.openingHours.sourceUrl,
      sample.listingUrl,
    );
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

test('model cannot turn RODEO seasonal New Year closure into regularClosingDays', async () => {
  const sample = captures.cases.find((entry) => entry.id === 'rodeo');
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
    listing.restaurant.openingHours,
  );
  assert.equal(result.value.profile.regularClosingDays, undefined);
});

test('official group JSON-LD is only a branch-navigation hint; matching branch hours require a refetch', async () => {
  const listingUrl = 'https://tabelog.com/tokyo/A1317/A131701/13213575/';
  const groupUrl = 'https://gf-restaurant.example/';
  const branchUrl = 'https://gf-restaurant.example/rodeo/nakameguro';
  const branchAddress = '東京都目黒区中目黒3-5-1';
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
      name: 'RODEO',
      address: {
        addressRegion: '東京都',
        addressLocality: '目黒区',
        streetAddress: '中目黒3-5-1',
      },
      // Directory records may contain fields, but those fields are not facts
      // until the referenced branch page has itself been fetched and matched.
      openingHoursSpecification: schedule,
    },
    {
      '@type': 'Restaurant',
      url: 'https://gf-restaurant.example/rodeo/shibuya',
      name: 'RODEO',
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
  const branchHtml = `<title>RODEO Nakameguro</title><p>Restaurant branch information.</p><script type="application/ld+json">${JSON.stringify({ '@type': 'Restaurant', url: branchUrl, name: 'RODEO', address: { addressRegion: '東京都', addressLocality: '目黒区', streetAddress: '中目黒3-5-1' }, openingHoursSpecification: schedule })}</script>`;
  const listing = {
    url: listingUrl,
    title: 'RODEO',
    content: `RODEO ${branchAddress}`,
    restaurant: {
      name: 'RODEO',
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
        if (url === 'https://gf-restaurant.example/rodeo/shibuya') {
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
        transientName: 'RODEO',
        transientAddress: branchAddress,
        ownerQuery: 'RODEO Nakameguro',
      },
    });
    assert.equal(result.kind, 'observed', variant);
    if (variant === 'matching_refetched') {
      assert.deepEqual(fetched, [branchUrl]);
      assert.match(
        result.value.profile.openingHours.value,
        /月・火・水・木・金 17:00 - 23:00/u,
      );
      assert.equal(result.value.profile.openingHours.sourceUrl, branchUrl);
    } else {
      assert.deepEqual(
        fetched,
        variant === 'wrong_branch_only' ? [] : [branchUrl],
      );
      assert.equal(result.value.profile.openingHours, undefined, variant);
    }
  }
});

test('hours scorer accepts equivalent Tabelog flat text and gold day labels', () => {
  const sample = JSON.parse(
    readFileSync(
      new URL('./restaurant-hours.v1.json', import.meta.url),
      'utf8',
    ),
  ).cases.find((entry) => entry.id === 'ramenya-shima-hours');
  const listing = parseTabelogListing(
    page(captures.cases.find((entry) => entry.id === 'shima')),
    sample.listingUrl,
  );
  const observed = {
    openingHours: {
      value: listing.restaurant.openingHours,
      sourceUrl: sample.listingUrl,
      observedAt: sample.openingHours.observedAt,
    },
    regularClosingDays: {
      value: listing.restaurant.regularClosingDays,
      sourceUrl: sample.listingUrl,
      observedAt: sample.regularClosingDays.observedAt,
    },
  };
  assert.equal(scoreRestaurantHours(sample, observed).pass, true);
});
