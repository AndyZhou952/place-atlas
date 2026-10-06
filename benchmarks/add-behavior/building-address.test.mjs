import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlaceResearchAgent } from '../../apps/web/agent/place-research.ts';
import { parseTabelogListing } from '../../apps/web/agent/tabelog-listing.ts';

const url = 'https://tabelog.com/tokyo/A1301/A130101/13999999/';
const name = '銀座 麺工房 本店';
const address =
  'Japan, 〒104-0061 Tokyo, Chuo City, Ginza, 7-chōme−2−１ 銀座セブン 地下1F';
const cases = [
  { label: 'omitted lot with bilingual numbered building', known: true },
  { label: 'same script building', building: '銀座セブン', known: true },
  { label: 'different block', street: '銀座7-3', known: false },
  {
    label: 'both lots explicit and conflicting',
    street: '銀座7-2-2',
    known: false,
  },
  { label: 'different building', building: 'GINZA8', known: false },
  { label: 'different floor', floor: '地下2F', known: false },
  { label: 'missing building', building: '', known: false },
  {
    label: 'generic building',
    building: 'ビル',
    selectedBuilding: 'ビル',
    known: false,
  },
  { label: 'missing postal code', postalCode: '', known: false },
  { label: 'different postal code', postalCode: '1040062', known: false },
  { label: 'different ward', ward: '港区', known: false },
  {
    label: 'different shop in same building',
    sourceName: '銀座 別の麺工房 本店',
    known: false,
  },
  {
    label: 'partial owner name is insufficient',
    ownerQuery: '銀座 麺工房',
    known: false,
  },
  { label: 'missing floor', floor: '', known: false },
  {
    label: 'ordinary explicit street still matches',
    street: '銀座7-2-1',
    building: '',
    floor: '',
    known: true,
  },
  {
    label: 'model failure preserves verified building facts',
    modelFailure: true,
    known: true,
  },
];
for (const sample of cases) {
  test(`selected building address: ${sample.label}`, async () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Restaurant',
      '@id': url,
      name: sample.sourceName ?? name,
      address: {
        addressRegion: '東京都',
        addressLocality: sample.ward ?? '中央区',
        streetAddress: `${sample.street ?? '銀座7-2'} ${sample.building ?? 'GINZA7'} ${sample.floor ?? '地下1F'}`,
        postalCode: sample.postalCode ?? '1040061',
      },
      aggregateRating: { '@type': 'AggregateRating', ratingValue: '3.50' },
      servesCuisine: '中華料理',
    })}</script><table><tr><th>予約可否</th><td>予約不可</td></tr><tr><th>営業時間</th><td>11:00 - 22:00 L.O. 21:30</td></tr></table>`;
    const evidence = parseTabelogListing(html, url);
    assert.ok(evidence);
    const queries = [];
    const diagnostics = [];
    const agent = createPlaceResearchAgent({
      onDiagnostic: (code) => diagnostics.push(code),
      apiKey: 'fixture',
      baseUrl: 'https://model.example/v1',
      model: 'fixture',
      searchApiKey: 'fixture',
      sourceReader: async () => ({ kind: 'read', evidence }),
      fetch: async (endpoint, init) => {
        if (endpoint === 'https://api.tavily.com/search') {
          queries.push(JSON.parse(init.body).query);
          return Response.json({
            results: [{ url, title: name, content: evidence.content }],
          });
        }
        assert.equal(endpoint, 'https://model.example/v1/chat/completions');
        return sample.modelFailure
          ? new Response('{}', { status: 503 })
          : Response.json({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      subjectMatch: 'unmatched',
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
        providerNamespace: 'google-places',
        placeId: 'synthetic-building',
        ownerQuery: sample.ownerQuery ?? name,
        transientName: 'Ginza Noodle Workshop',
        transientAddress: sample.selectedBuilding
          ? address.replace('銀座セブン', sample.selectedBuilding)
          : address,
      },
    });
    assert.equal(queries.length, 1);
    assert.ok(diagnostics.includes('listing_read_read'));
    assert.ok(
      diagnostics.includes(
        sample.known ? 'listing_branch_match' : 'listing_branch_mismatch',
      ),
    );
    assert.equal(result.value?.tabelog.status === 'known', sample.known);
    if (sample.known) {
      assert.equal(result.value.tabelog.url, url);
      assert.equal(result.value.reservation.mode, 'not_reservable');
      assert.equal(result.value.profile.openingHours.sourceUrl, url);
      assert.equal(
        result.value.profile.openingHours.value,
        '11:00 - 22:00 L.O. 21:30',
      );
      assert.equal(result.value.profile.regularClosingDays, undefined);
    }
  });
}
