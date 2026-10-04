import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createPlaceResearchAgent } from '../../apps/web/agent/place-research.ts';

const dataset = JSON.parse(
  readFileSync(
    new URL('./aomori-selected-branch.v1.json', import.meta.url),
    'utf8',
  ),
);

for (const row of dataset.cases) {
  test(`Aomori selected-branch research: ${row.id}`, async () => {
    const queried = [];
    const agent = createPlaceResearchAgent({
      apiKey: 'test',
      baseUrl: 'https://model.example/v1',
      model: 'test-model',
      searchApiKey: 'test',
      readSourcePages: true,
      sourceReader: async (url) => {
        assert.equal(url, dataset.source.url);
        return {
          kind: 'read',
          evidence: {
            url,
            title: dataset.source.name,
            content: `${dataset.source.name} ${row.sourceAddress} Tabelog aggregate restaurant rating: ${dataset.source.aggregateScoreSnapshot}`,
            restaurant: {
              name: dataset.source.name,
              address: row.sourceAddress,
              postalCode: row.sourcePostalCode,
              area: '青森市古川',
              score: dataset.source.aggregateScoreSnapshot,
              categories: ['海鮮', '洋食'],
              coordinates: { latitude: 40.824, longitude: 140.735 },
              reservation: dataset.source.reservation,
            },
          },
        };
      },
      fetch: async (endpoint, init) => {
        if (endpoint === 'https://api.tavily.com/search') {
          queried.push(JSON.parse(init.body).query);
          return Response.json({
            results: [
              {
                url: dataset.source.url,
                title: dataset.source.name,
                content: `${dataset.source.name} ${row.sourceAddress}`,
              },
            ],
          });
        }
        assert.equal(endpoint, 'https://model.example/v1/chat/completions');
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  subjectMatch: 'uncertain',
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
      selectedSubject: {
        ownerQuery: row.ownerQuery,
        providerNamespace: 'google-places',
        placeId: 'selected-google-id',
        transientName: dataset.selected.name,
        transientAddress: dataset.selected.address,
      },
    });
    assert.equal(result.kind, 'observed');
    assert.match(queried[0], /site:tabelog\.com/u);
    assert.equal(result.value.tabelog.status === 'known', row.expectKnown);
    if (row.expectKnown) {
      assert.equal(
        result.value.tabelog.score,
        dataset.source.aggregateScoreSnapshot,
      );
      assert.equal(result.value.profile.address.value, row.sourceAddress);
      assert.equal(result.value.reservation.mode, 'reservable');
    } else {
      assert.equal(result.value.profile, undefined);
    }
  });
}
