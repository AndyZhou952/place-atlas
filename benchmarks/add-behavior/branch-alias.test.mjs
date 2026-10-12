import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

import { createPlaceResearchAgent } from '../../apps/web/agent/place-research.ts';
import { parseTabelogListing } from '../../apps/web/agent/tabelog-listing.ts';
import { createAtlasApplication } from '../../apps/web/product/application/atlas-application.ts';
import {
  createCatalogIntakeModule,
  createCatalogIntakeOperationGroup,
  createInMemoryCatalogIntakeStatePort,
} from '../../apps/web/product/application/catalog-intake/catalog-intake-coordinator.ts';

const dataset = JSON.parse(
  await readFile(new URL('./branch-alias.v1.json', import.meta.url), 'utf8'),
);

assert.equal(dataset.schemaVersion, 1);
assert.equal(dataset.cases.length, 12);
assert.equal(new Set(dataset.cases.map((entry) => entry.caseId)).size, 12);
test('branch aliases retain one active benchmark and the voice case in live acceptance', async () => {
  const files = await readdir(new URL('.', import.meta.url));
  assert.deepEqual(
    files.filter((name) => /^branch-alias\.v\d+\.json$/u.test(name)),
    ['branch-alias.v1.json'],
  );
  const live = JSON.parse(
    await readFile(new URL('./live-add.v1.json', import.meta.url), 'utf8'),
  );
  const voice = live.cases.find(
    (sample) => sample.id === 'maison-landemaine-atre-ebisu-voice',
  );
  assert.equal(live.cases.length, 11);
  assert.equal(
    voice.query,
    dataset.cases.find(
      (sample) => sample.caseId === 'maison-voice-halfwidth-u-sparse-model',
    ).ownerQuery,
  );
  assert.equal(
    voice.expectedTabelogUrl,
    dataset.additionalFixtures.maison.listing.sourceUrl,
  );
});
for (const entry of dataset.cases) {
  test(`Add branch research: ${entry.caseId}`, async () => {
    const { agent, fixture, listing, searchCalls, diagnostics } =
      createResearchFixture(entry);
    const result = await agent.research({
      phase: 'initial',
      selectedSubject: {
        ...fixture.selectedSubject,
        ownerQuery: entry.ownerQuery,
      },
      scope: { ownerId: 'benchmark', channel: 'web', conversationId: 'add' },
      sessionId: 'benchmark-session',
      expectedSessionVersion: 1,
      queryOrUrlsDigest: 'benchmark',
    });
    assert.equal(searchCalls(), 1, entry.caseId);
    assert.equal(result.kind, 'observed', entry.caseId);
    assert.equal(
      result.value.tabelog.status,
      entry.expectedKnown ? 'known' : 'unknown',
      entry.caseId,
    );
    if (entry.expectedKnown) {
      assert.equal(result.value.tabelog.score, listing.aggregateScore);
      assert.equal(result.value.profile.name.value, listing.name);
      if (listing.coordinates) {
        assert.deepEqual(
          result.value.profile.coordinates.value,
          listing.coordinates,
        );
        assert.equal(
          result.value.profile.coordinates.sourceUrl,
          listing.sourceUrl,
        );
        assert.equal(result.value.profile.address.sourceUrl, listing.sourceUrl);
        assert.equal(result.value.reservation.mode, 'not_reservable');
        assert.ok(diagnostics.includes('tabelog_listing_read_geo'));
        if (!entry.model)
          assert.ok(diagnostics.includes('parsed_listing_branch_match'));
        assert.equal(
          result.value.profile.officialWebsite.value,
          listing.officialWebsite,
        );
      }
    } else {
      assert.equal(result.value.profile?.coordinates, undefined);
    }
  });
}

function createResearchFixture(entry) {
  const fixture = entry.fixture
    ? dataset.additionalFixtures[entry.fixture]
    : dataset;
  const listing = fixture.listing;
  const listedName = entry.listedName ?? listing.name;
  const nameRow = entry.listingAlias
    ? `${listedName} （${entry.listingAlias}）`
    : listedName;
  const sourceUrl =
    entry.source === 'review_url'
      ? listing.sourceUrl + 'dtlrvwlst/'
      : listing.sourceUrl;
  const html =
    `<script type="application/ld+json">${JSON.stringify({
      '@type': 'Restaurant',
      '@id': sourceUrl,
      name: listedName,
      address: {
        addressRegion: listing.addressRegion,
        addressLocality: listing.addressLocality,
        streetAddress: entry.streetAddress,
        postalCode: entry.postalCode ?? listing.postalCode,
      },
      geo: listing.coordinates,
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: listing.aggregateScore,
      },
      servesCuisine: listing.categories,
    })}</script>` +
    `<table><tr><th>店名</th><td>${nameRow}</td></tr>` +
    (listing.reservation
      ? `<tr><th>予約可否</th><td>${listing.reservation}</td></tr>`
      : '') +
    (listing.officialWebsite
      ? `<tr><th>ホームページ</th><td><a href="${listing.officialWebsite}">Website</a></td></tr>`
      : '') +
    '</table>';
  const evidence = parseTabelogListing(html, sourceUrl);
  if (entry.source === 'review_url') assert.equal(evidence, undefined);
  else assert.ok(evidence, entry.caseId);
  if (evidence)
    assert.deepEqual(
      evidence.restaurant.aliases,
      entry.listingAlias ? [entry.listingAlias] : [],
      entry.caseId,
    );
  let searchCount = 0;
  const diagnostics = [];
  const agent = createPlaceResearchAgent({
    apiKey: 'benchmark-key',
    baseUrl: 'https://model.example/v1',
    model: 'benchmark-model',
    searchApiKey: 'benchmark-search',
    onDiagnostic: (code) => diagnostics.push(code),
    sourceReader: async (url) => {
      assert.equal(url, listing.sourceUrl);
      return entry.source === 'blocked'
        ? { kind: 'blocked' }
        : { kind: 'read', evidence };
    },
    fetch: async (endpoint, init) => {
      if (endpoint === 'https://api.tavily.com/search') {
        searchCount++;
        return Response.json({
          results: [
            {
              url: sourceUrl,
              title: nameRow,
              content: `${nameRow} ${listing.addressRegion}${listing.addressLocality}${entry.streetAddress}`,
            },
          ],
        });
      }
      assert.equal(endpoint, 'https://model.example/v1/chat/completions');
      assert.doesNotMatch(
        init.body,
        /expectedKnown|caseId|expectedTitleIncludes/u,
      );
      if (entry.model === 'http_error')
        return Response.json({}, { status: 503 });
      return Response.json({
        choices: [
          {
            message: {
              content:
                entry.model === 'invalid_json'
                  ? '{invalid json'
                  : JSON.stringify({
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
  return {
    agent,
    fixture,
    listing,
    diagnostics,
    searchCalls: () => searchCount,
  };
}

for (const caseId of [
  'maison-voice-halfwidth-u-sparse-model',
  'maison-voice-other-business-same-building-rejected',
]) {
  test(`Add voice journey: ${caseId}`, async () => {
    const entry = dataset.cases.find((sample) => sample.caseId === caseId);
    const { agent, fixture, listing } = createResearchFixture(entry);
    const selected = fixture.selectedSubject;
    const candidate = {
      durableIdentity: {
        providerNamespace: selected.providerNamespace,
        placeId: selected.placeId,
        ordinal: 1,
      },
      transientPresentation: {
        name: selected.transientName,
        address: selected.transientAddress,
        attribution: { label: 'Google Maps', url: 'https://maps.google.com/' },
      },
    };
    const clock = { now: () => new Date() };
    const publications = [];
    const intakeModule = createCatalogIntakeModule({
      discoveryPort: {
        async discover() {
          return {
            ok: true,
            value: { candidates: [candidate], hasMore: false },
          };
        },
        async refetch({ placeId }) {
          assert.equal(placeId, selected.placeId);
          return { ok: true, value: candidate };
        },
      },
      statePort: createInMemoryCatalogIntakeStatePort(clock),
      clock,
      idSource: { nextId: () => 'maison-session' },
      catalogRevision: { read: async () => 'catalog-r1' },
      durableGeocoderPort: {
        async propose() {
          return { ok: true, value: { status: 'no_match' } };
        },
      },
      enrichmentPolicy: 'enrich_if_available',
      webResearchPort: agent,
      atlasCatalogIntakePort: {
        async publish(input) {
          publications.push(input);
          return {
            status: 'committed_verified',
            itemId: 'maison-ebisu',
            receiptRef: 'maison-receipt',
            replayed: false,
          };
        },
      },
    });
    const app = createAtlasApplication(
      createCatalogIntakeOperationGroup(intakeModule),
    );
    const context = {
      invocation: {
        ownerId: 'benchmark',
        channel: 'web',
        conversationId: 'maison',
      },
    };
    const discover = await app.execute(
      {
        key: 'catalog.intake.discover',
        input: { query: entry.ownerQuery, requestToken: 'maison-request' },
      },
      context,
    );
    assert.equal(discover.ok, true);
    const result = await app.execute(
      {
        key: 'catalog.intake.select',
        input: {
          sessionId: discover.value.sessionId,
          expectedSessionVersion: discover.value.sessionVersion,
          ordinal: 1,
        },
      },
      context,
    );
    assert.equal(result.ok, true);
    assert.equal(result.value.status, 'preview_ready');
    const preview = result.value.preview;
    assert.equal(
      preview.locationEvidence.status,
      entry.expectedKnown ? 'known' : 'unknown',
    );
    assert.equal(
      preview.unknownFields.includes('coordinates'),
      !entry.expectedKnown,
    );
    assert.deepEqual(preview.ownerFields, {});
    if (entry.expectedKnown) {
      assert.equal(preview.locationEvidence.sourceUrl, listing.sourceUrl);
      assert.equal(
        preview.locationEvidence.latitude,
        listing.coordinates.latitude,
      );
      assert.equal(
        preview.locationEvidence.longitude,
        listing.coordinates.longitude,
      );
      assert.equal(preview.titleProposal.value, listing.name);
    }
    let confirmed = await app.execute(
      {
        key: 'catalog.intake.confirm',
        input: {
          sessionId: discover.value.sessionId,
          expectedPreviewVersion: preview.previewVersion,
        },
      },
      context,
    );
    assert.equal(confirmed.ok, true);
    if (entry.expectedKnown && confirmed.value.status === 'conflict') {
      assert.equal(publications.length, 0);
      const refreshed = confirmed.value.newPreview;
      assert.equal(refreshed.locationEvidence.status, 'known');
      assert.equal(refreshed.locationEvidence.sourceUrl, listing.sourceUrl);
      confirmed = await app.execute(
        {
          key: 'catalog.intake.confirm',
          input: {
            sessionId: discover.value.sessionId,
            expectedPreviewVersion: refreshed.previewVersion,
          },
        },
        context,
      );
      assert.equal(confirmed.ok, true);
    }
    assert.equal(
      confirmed.value.status,
      entry.expectedKnown ? 'committed_verified' : 'failed_no_write',
    );
    assert.equal(publications.length, entry.expectedKnown ? 1 : 0);
    if (entry.expectedKnown) {
      assert.equal(
        publications[0].locationEvidence.sourceUrl,
        listing.sourceUrl,
      );
    }
  });
}
