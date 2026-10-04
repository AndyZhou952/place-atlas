import assert from 'node:assert/strict';
import test from 'node:test';

import {
  presentCatalogIntakePreview,
  presentCatalogIntakePreviewText,
} from './catalog-intake-preview-presenter.ts';

test('closed preview presentation exposes every persisted fact and its evidence before confirm', () => {
  const preview = fullPreview();
  const presentation = presentCatalogIntakePreview(preview);

  assert.deepEqual(
    presentation.fields.map(({ key }) => key),
    [
      'identity',
      'title',
      'area',
      'address',
      'coordinates',
      'tabelog',
      'reservation',
    ],
  );
  assert.match(presentation.fields[1].evidence, /Agent observed/u);
  assert.equal(
    presentation.fields[1].sourceUrl,
    'https://restaurant.example/name',
  );
  assert.equal(presentation.fields[1].evidenceAt, '2026-09-23T12:00:00.000Z');
  assert.match(presentation.fields[4].evidence, /Durable geocoder observed/u);
  assert.match(presentation.fields[5].value, /4\.21 · 321 reviews/u);
  assert.match(presentation.fields[5].evidence, /Agent observed · stale/u);
  assert.match(presentation.fields[6].value, /Reservation required/u);
  assert.match(presentation.fields[6].value, /30 days ahead/u);
  assert.deepEqual(presentation.duplicates, [
    {
      itemId: 'existing-1',
      title: 'Existing Sushi',
      address: '東京都中央区銀座1-1-2',
      match: 'strong',
    },
  ]);
  assert.deepEqual(presentation.unknownFields, ['reservation']);
  assert.deepEqual(presentation.warnings, [
    { code: 'stale_evidence', message: 'Tabelog evidence changed.' },
  ]);

  const text = presentCatalogIntakePreviewText(preview);
  for (const expected of [
    'Preview v4',
    'Google identity',
    'Agent observed',
    '4.21 · 321 reviews',
    'Reservation required',
    '30 days ahead',
    'Possible duplicate',
    'Still unknown: reservation',
    'Warning: Tabelog evidence changed.',
  ]) {
    assert.match(text, new RegExp(expected, 'u'));
  }
});

test('overseas preview omits inapplicable Tabelog from fields and warnings', () => {
  const preview = fullPreview();
  preview.ownerFields = { address: '7 Dempsey Road, Singapore 249671' };
  preview.tabelog = { status: 'unknown' };
  preview.unknownFields = ['tabelog', 'reservation'];
  const presentation = presentCatalogIntakePreview(preview);
  assert.equal(
    presentation.fields.some((field) => field.key === 'tabelog'),
    false,
  );
  assert.deepEqual(presentation.unknownFields, ['reservation']);
  assert.doesNotMatch(presentCatalogIntakePreviewText(preview), /^Tabelog:/mu);
});

function fullPreview() {
  return {
    sessionId: 'session-1',
    previewVersion: 4,
    state: 'preview_ready',
    candidateIdentity: {
      providerNamespace: 'google-places',
      placeId: 'place-1',
    },
    ownerFields: { area: '銀座' },
    titleProposal: {
      provenance: 'agent_observed',
      value: '鮨青空',
      sourceUrl: 'https://restaurant.example/name',
      observedAt: '2026-09-23T12:00:00.000Z',
    },
    addressProposal: {
      provenance: 'durable_geocoder_observed',
      value: '東京都中央区銀座1-1-1',
      sourceUrl: 'https://www.openstreetmap.org/node/1',
      license: 'OpenStreetMap contributors, ODbL 1.0',
      checkedAt: '2026-09-23T12:01:00.000Z',
    },
    locationEvidence: {
      status: 'known',
      provenance: 'durable_geocoder_observed',
      normalizedAddress: '東京都中央区銀座1-1-1',
      latitude: 35.671,
      longitude: 139.765,
      provider: 'Nominatim',
      sourceUrl: 'https://www.openstreetmap.org/node/1',
      license: 'OpenStreetMap contributors, ODbL 1.0',
      checkedAt: '2026-09-23T12:01:00.000Z',
    },
    tabelog: {
      status: 'known',
      score: 4.21,
      reviewCount: 321,
      url: 'https://tabelog.com/tokyo/A1301/A130101/13000001/',
      provenance: 'agent_observed',
      observedAt: '2026-09-23T12:02:00.000Z',
      freshness: 'stale',
    },
    reservation: {
      status: 'known',
      mode: 'reservation_required',
      label: 'Reservation required',
      advanceDays: 30,
      bookingWindowLabel: 'Book one month ahead',
      releaseNote: 'Seats release monthly',
      channel: 'Official website',
      url: 'https://restaurant.example/reservations',
      provenance: 'agent_observed',
      observedAt: '2026-09-23T12:03:00.000Z',
      freshness: 'fresh',
    },
    suspectedDuplicates: [
      {
        itemId: 'existing-1',
        title: 'Existing Sushi',
        address: '東京都中央区銀座1-1-2',
        match: 'strong',
      },
    ],
    unknownFields: ['reservation'],
    warnings: [
      { code: 'stale_evidence', message: 'Tabelog evidence changed.' },
    ],
    evidenceDigest: 'a'.repeat(64),
    catalogRevision: 'catalog-r1',
    expiresAt: '2026-09-23T12:30:00.000Z',
  };
}
