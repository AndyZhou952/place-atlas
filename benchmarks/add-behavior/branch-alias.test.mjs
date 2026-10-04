import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createPlaceResearchAgent } from '../../apps/web/agent/place-research.ts';
import { parseTabelogListing } from '../../apps/web/agent/tabelog-listing.ts';

const dataset = JSON.parse(
  await readFile(new URL('./branch-alias.v1.json', import.meta.url), 'utf8'),
);

assert.equal(dataset.schemaVersion, 1);
assert.equal(dataset.cases.length, 3);
for (const entry of dataset.cases) {
  test(`Add branch research: ${entry.caseId}`, async () => {
    const listing = dataset.listing;
    const nameRow = entry.listingAlias
      ? `${listing.name} （${entry.listingAlias}）`
      : listing.name;
    const html =
      `<script type="application/ld+json">${JSON.stringify({
        '@type': 'Restaurant',
        '@id': listing.sourceUrl,
        name: listing.name,
        address: {
          addressRegion: listing.addressRegion,
          addressLocality: listing.addressLocality,
          streetAddress: entry.streetAddress,
        },
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: listing.aggregateScore,
        },
        servesCuisine: listing.categories,
      })}</script>` +
      `<table><tr><th>店名</th><td>${nameRow}</td></tr></table>`;
    const evidence = parseTabelogListing(html, listing.sourceUrl);
    assert.ok(evidence, entry.caseId);
    assert.deepEqual(
      evidence.restaurant.aliases,
      entry.listingAlias ? [entry.listingAlias] : [],
      entry.caseId,
    );
    let searchCalls = 0;
    const agent = createPlaceResearchAgent({
      apiKey: 'benchmark-key',
      baseUrl: 'https://model.example/v1',
      model: 'benchmark-model',
      searchApiKey: 'benchmark-search',
      sourceReader: async (url) => {
        assert.equal(url, listing.sourceUrl);
        return { kind: 'read', evidence };
      },
      fetch: async (endpoint) => {
        if (endpoint === 'https://api.tavily.com/search') {
          searchCalls++;
          return Response.json({
            results: [
              {
                url: listing.sourceUrl,
                title: nameRow,
                content: `${nameRow} ${listing.addressRegion}${listing.addressLocality}${entry.streetAddress}`,
              },
            ],
          });
        }
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  subjectMatch: 'matched',
                  tabelog: { status: 'unknown' },
                  reservation: { status: 'unknown' },
                }),
              },
            },
          ],
        });
      },
    });
    const result = await agent.research({
      phase: 'initial',
      selectedSubject: {
        ...dataset.selectedSubject,
        ownerQuery: entry.ownerQuery,
      },
      scope: { ownerId: 'benchmark', channel: 'web', conversationId: 'add' },
      sessionId: 'benchmark-session',
      expectedSessionVersion: 1,
      queryOrUrlsDigest: 'benchmark',
    });
    assert.equal(searchCalls, 1, entry.caseId);
    assert.equal(result.kind, 'observed', entry.caseId);
    assert.equal(
      result.value.tabelog.status,
      entry.expectedKnown ? 'known' : 'unknown',
      entry.caseId,
    );
    if (entry.expectedKnown) {
      assert.equal(result.value.tabelog.score, listing.aggregateScore);
      assert.equal(result.value.profile.name.value, listing.name);
    }
  });
}
