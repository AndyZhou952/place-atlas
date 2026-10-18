import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPlaceResearchAgent,
  initialResearchQuery,
} from '../../apps/web/agent/place-research.ts';
import { parseTabelogListing } from '../../apps/web/agent/tabelog-listing.ts';
import { createGooglePlaceDiscoveryAdapter } from '../../apps/web/adapters/providers/google-place-discovery.ts';
import { createTabelogPlaceDiscoveryPort } from '../../apps/web/adapters/providers/tabelog-place-discovery.ts';
import {
  createCatalogIntakeModule,
  createInMemoryCatalogIntakeStatePort,
} from '../../apps/web/product/application/catalog-intake/catalog-intake-coordinator.ts';

const url = 'https://tabelog.com/iwate/A0301/A030101/3999999/';
const name = '青葉亭 盛岡ステーション店';
const address = '岩手県盛岡市駅前通2-55 青葉駅ビル お食事館 1F';
const selected = {
  ownerQuery: '青葉亭 盛岡',
  providerNamespace: 'google-places',
  placeId: 'synthetic-station-branch',
  transientName: 'Aobatei',
  transientAddress:
    'Japan, 〒020-0034 Iwate, Morioka, Ekimaedori, 2−５５ 1F 青葉駅ビル お食事館',
};
function listing(
  street = '駅前通2-55 青葉駅ビル お食事館 1F',
  postcode = '0200034',
) {
  return parseTabelogListing(
    `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Restaurant',
      '@id': url,
      name,
      address: {
        addressRegion: '岩手県',
        addressLocality: '盛岡市',
        streetAddress: street,
        postalCode: postcode,
      },
      geo: { latitude: 39.7, longitude: 141.1 },
      aggregateRating: { '@type': 'AggregateRating', ratingValue: '3.5' },
    })}</script>`,
    url,
  );
}
function research(evidence) {
  return createPlaceResearchAgent({
    apiKey: 'fixture',
    baseUrl: 'https://model.example/v1',
    model: 'fixture',
    sourceReader: async () => ({ kind: 'read', evidence }),
    fetch: async (target) => {
      if (target.startsWith('https://search.yahoo.co.jp/search')) {
        const query = new URL(target).searchParams.get('p');
        assert.ok(query.includes('青葉駅ビル お食事館'), query);
        assert.ok(query.includes('2-55'), query);
        assert.ok(!query.includes('2-55-1'), query);
        return new Response(
          `<div id="web"><li><a href="${url}">${name}</a><div>${address}</div></li></div>`,
        );
      }
      assert.equal(target, 'https://model.example/v1/chat/completions');
      return new Response('{}', { status: 503 });
    },
  });
}

test('selected station branch search preserves building context without inventing a street lot from its floor', () => {
  const query = initialResearchQuery(selected);
  assert.match(query, /青葉駅ビル お食事館 2-55 site:tabelog\.com$/u);
  assert.doesNotMatch(query, /2-55-1/u);
});

for (const [label, street, postcode, known] of [
  ['matching two-part street and postcode', undefined, undefined, true],
  ['different floor', '駅前通2-55 青葉駅ビル お食事館 2F', undefined, false],
  ['different street', '駅前通2-56 青葉駅ビル お食事館 1F', undefined, false],
  ['different postcode', undefined, '0200035', false],
  ['missing postcode', undefined, '', false],
]) {
  test(`selected station branch model failure: ${label}`, async () => {
    const result = await research(listing(street, postcode)).research({
      selectedSubject: selected,
    });
    assert.equal(result.value?.profile?.coordinates !== undefined, known);
    if (known) assert.equal(result.value.profile.address.value, address);
  });
}

for (const channel of ['web', 'external_agent']) {
  test(`choosing the second branch through ${channel} publishes only after explicit confirmation`, async () => {
    const evidence = listing();
    const places = [
      {
        placeId: 'synthetic-main-branch',
        relevance: 1,
        name: 'Aobatei',
        address: 'Another street',
      },
      {
        placeId: selected.placeId,
        relevance: 0.9,
        name: selected.transientName,
        address: selected.transientAddress,
      },
    ];
    const google = createGooglePlaceDiscoveryAdapter({
      async searchText() {
        return { ok: true, value: { places, hasMore: false } };
      },
      async getPlace({ placeId }) {
        return {
          ok: true,
          value: places.find((place) => place.placeId === placeId),
        };
      },
    });
    const discovery = createTabelogPlaceDiscoveryPort({
      textDiscovery: google,
      sourceReader: async () => ({ kind: 'read', evidence }),
    });
    const clock = { now: () => new Date() };
    const writes = [];
    const intake = createCatalogIntakeModule({
      discoveryPort: discovery,
      webResearchPort: research(evidence),
      enrichmentPolicy: 'enrich_if_available',
      statePort: createInMemoryCatalogIntakeStatePort(clock),
      atlasCatalogIntakePort: {
        async publish(input) {
          writes.push(input);
          return {
            status: 'committed_verified',
            itemId: 'synthetic-saved-branch',
            receiptRef: 'synthetic-receipt',
            replayed: false,
          };
        },
      },
      clock,
      idSource: { nextId: () => crypto.randomUUID() },
      catalogRevision: { read: async () => 'r1' },
    });
    const scope = {
      ownerId: 'owner',
      channel,
      conversationId: 'synthetic-conversation',
    };
    const found = await intake.discover(
      { query: selected.ownerQuery, requestToken: 'synthetic-request' },
      scope,
    );
    assert.equal(found.ok, true);
    assert.equal(found.value.candidates.length, 2);
    const preview = await intake.select(
      {
        sessionId: found.value.sessionId,
        expectedSessionVersion: 1,
        ordinal: 2,
        requestResearch: true,
      },
      scope,
    );
    assert.equal(preview.ok, true, JSON.stringify(preview));
    assert.equal(preview.value.status, 'preview_ready');
    assert.equal(
      preview.value.preview.candidateIdentity.placeId,
      selected.placeId,
    );
    assert.equal(preview.value.preview.locationEvidence.status, 'known');
    assert.equal(preview.value.preview.addressProposal.value, address);
    assert.equal(writes.length, 0);
    const saved = await intake.confirm(
      {
        sessionId: found.value.sessionId,
        expectedPreviewVersion: preview.value.preview.previewVersion,
      },
      scope,
    );
    assert.equal(
      saved.ok && saved.value.status,
      'committed_verified',
      JSON.stringify(saved),
    );
    assert.equal(writes.length, 1);
    assert.equal(writes[0].candidateIdentity.placeId, selected.placeId);
  });
}
