import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  createPlaceResearchAgent,
  initialResearchQuery,
} from '../../apps/web/agent/place-research.ts';
import { parseTabelogListing } from '../../apps/web/agent/tabelog-listing.ts';

const dataset = JSON.parse(
  readFileSync(
    new URL('./numeric-branch-variant.v1.json', import.meta.url),
    'utf8',
  ),
);
assert.equal(dataset.schemaVersion, 1);
assert.equal(dataset.cases.length, 4);

for (const sample of dataset.cases) {
  test(`Add numeric branch: ${sample.id}`, async () => {
    const listing = dataset.listing;
    const selectedSubject = {
      ...dataset.selectedSubject,
      ownerQuery: sample.ownerQuery,
    };
    const query = initialResearchQuery(selectedSubject);
    if (sample.expectedQueryName) {
      assert.equal(
        query,
        `${sample.expectedQueryName} 3-14-22 site:tabelog.com`,
      );
    }
    const html =
      `<script type="application/ld+json">${JSON.stringify({
        '@type': 'Restaurant',
        '@id': listing.url,
        name: sample.listedName,
        address: {
          addressRegion: listing.addressRegion,
          addressLocality: listing.addressLocality,
          streetAddress: sample.streetAddress,
          postalCode: listing.postalCode,
        },
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: listing.score,
        },
        servesCuisine: '牛料理、カレー',
      })}</script>` +
      `<table><tr><th>店名</th><td>${sample.listedName}</td></tr>` +
      `<tr><th>予約可否</th><td>${listing.reservation}</td></tr></table>`;
    const evidence = parseTabelogListing(html, listing.url);
    assert.ok(evidence);
    const agent = createPlaceResearchAgent({
      apiKey: 'fixture',
      baseUrl: 'https://model.example/v1',
      model: 'fixture',
      sourceReader: async (url) => {
        assert.equal(url, listing.url);
        return { kind: 'read', evidence };
      },
      fetch: async (url) => {
        if (url.startsWith('https://search.yahoo.co.jp/search'))
          return new Response(
            `<div id="web"><li><a href="${listing.url}">${sample.listedName}</a><div>${listing.addressRegion}${listing.addressLocality}${sample.streetAddress}</div></li></div>`,
            { headers: { 'content-type': 'text/html' } },
          );
        assert.equal(url, 'https://model.example/v1/chat/completions');
        return Response.json({
          choices: [{ message: { content: '{invalid json' } }],
        });
      },
    });
    const result = await agent.research({ selectedSubject });
    assert.equal(
      result.kind,
      sample.expectedKnown ? 'observed' : 'unavailable',
    );
    if (result.kind !== 'observed') return;
    assert.equal(
      result.value.tabelog.status,
      sample.expectedKnown ? 'known' : 'unknown',
    );
    assert.equal(
      result.value.reservation.status,
      sample.expectedKnown ? 'known' : 'unknown',
    );
    if (sample.expectedKnown) {
      assert.equal(result.value.tabelog.score, listing.score);
      assert.equal(result.value.reservation.mode, 'not_reservable');
    }
  });
}
