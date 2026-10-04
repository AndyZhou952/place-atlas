import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createPlaceResearchAgent,
  initialResearchQuery,
  researchRegion,
} from '../../apps/web/agent/place-research.ts';

const dataset = JSON.parse(
  readFileSync(new URL('./region-research.v1.json', import.meta.url), 'utf8'),
);

for (const row of dataset.cases) {
  test(`region research plan: ${row.id}`, () => {
    const subject = {
      transientName: row.name,
      transientAddress: row.address,
      ownerQuery: row.ownerQuery,
    };
    assert.equal(researchRegion(row.address), row.region);
    const query = initialResearchQuery(subject);
    assert.ok(query.includes(row.queryIncludes), query);
    assert.equal(query.includes('site:tabelog.com'), row.region === 'japan');
  });
}

const googleUrl = 'https://www.google.com/maps/place/Burnt+Ends';
const overseasAddress = '7 Dempsey Road, Singapore 249671';
const overseasName = 'Burnt Ends';
const sourceContent = `${overseasName} ${overseasAddress}. Google rating 4.6 from 1200 reviews.`;

function agentForRegion(
  address,
  googleRating = { score: 4.6, reviewCount: 1200 },
) {
  const queries = [];
  const agent = createPlaceResearchAgent({
    apiKey: 'test',
    baseUrl: 'https://model.example/v1',
    model: 'test-model',
    searchApiKey: 'test',
    readSourcePages: true,
    fetch: async (endpoint, init) => {
      if (endpoint === 'https://api.tavily.com/search') {
        const query = JSON.parse(init.body).query;
        queries.push(query);
        return Response.json({
          results: [
            { url: googleUrl, title: overseasName, content: sourceContent },
          ],
        });
      }
      assert.equal(endpoint, 'https://model.example/v1/chat/completions');
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                subjectMatch: 'matched',
                tabelog: { status: 'unknown' },
                reservation: { status: 'unknown' },
                profile: { googleRating },
                evidence: {
                  googleRating: {
                    url: googleUrl,
                    quote: 'Google rating 4.6 from 1200 reviews.',
                    identityQuote: `${overseasName} ${overseasAddress}`,
                  },
                },
              }),
            },
          },
        ],
      });
    },
  });
  return { agent, queries };
}

test('production research accepts exact-branch Google Maps rating outside Japan', async () => {
  const { agent, queries } = agentForRegion(overseasAddress);
  const result = await agent.research({
    selectedSubject: {
      ownerQuery: overseasName,
      providerNamespace: 'google-places',
      placeId: 'google-place-example',
      transientName: overseasName,
      transientAddress: overseasAddress,
    },
  });
  assert.equal(result.kind, 'observed');
  assert.deepEqual(result.value.profile.googleRating.value, {
    score: 4.6,
    reviewCount: 1200,
  });
  assert.match(queries[0], /official reservation/u);
  assert.doesNotMatch(queries[0], /tabelog/u);
});

test('mainland China omits an external Google rating even when a model proposes one', async () => {
  const { agent, queries } = agentForRegion(
    '中国浙江省杭州市西湖区天目山路398号',
  );
  const result = await agent.research({
    selectedSubject: {
      ownerQuery: overseasName,
      providerNamespace: 'google-places',
      placeId: 'google-place-example',
      transientName: overseasName,
      transientAddress: '中国浙江省杭州市西湖区天目山路398号',
    },
  });
  assert.equal(result.kind, 'observed');
  assert.equal(result.value.profile?.googleRating, undefined);
  assert.match(queries[0], /official reservation/u);
});
