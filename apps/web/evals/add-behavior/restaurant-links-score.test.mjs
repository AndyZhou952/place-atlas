import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { scoreRestaurantLinks } from './restaurant-links-score.mjs';

const benchmark = JSON.parse(
  await readFile(
    new URL('./restaurant-links.v1.json', import.meta.url),
    'utf8',
  ),
);
const rodeo = benchmark.cases[0];
const shima = benchmark.cases[1];

function preview({
  tabelogUrl = rodeo.expected.tabelogUrl,
  bookingUrl = rodeo.expected.bookingUrl,
  websiteUrl = rodeo.expected.officialWebsite.url,
  provenance = 'agent_observed',
  freshness = 'fresh',
  sourceUrl = 'https://gf-restaurant.jp/rodeo/nakameguro',
} = {}) {
  const observedAt = '2026-10-04T00:00:00.000Z';
  return {
    tabelog: {
      status: 'known',
      url: tabelogUrl,
      provenance,
      freshness,
      observedAt,
    },
    reservation: {
      status: 'known',
      url: bookingUrl,
      provenance,
      freshness,
      observedAt,
    },
    profile: {
      officialWebsite: {
        value: websiteUrl,
        sourceUrl,
        observedAt,
      },
      bookingLink: {
        value: bookingUrl,
        sourceUrl,
        observedAt,
      },
    },
    warnings: [],
    unknownFields: [],
  };
}

const rodeoCandidate = {
  transientName: 'RODEO',
  transientAddress: '東京都目黒区中目黒3-5-1 中目黒プレアタワー',
};

test('the Japanese address signature rejects Shima at the conflicting adjacent number', () => {
  const report = scoreRestaurantLinks(shima, {
    candidate: {
      transientName: 'らぁ麺や 嶋',
      transientAddress: '東京都渋谷区本町3-41-11',
    },
  });
  assert.equal(report.checks.identity.pass, false);
  assert.equal(report.diagnostics.addressMismatchForMatchingName, true);
});

test('passes when all exact URLs, sourced evidence, and selected branch match', () => {
  const report = scoreRestaurantLinks(rodeo, {
    candidate: rodeoCandidate,
    preview: preview(),
  });
  assert.equal(report.pass, true);
  assert.ok(Object.values(report.checks).every((check) => check.pass));
});

test('wrong booking URL fails even when reservation mode would be correct', () => {
  const observed = preview({ bookingUrl: 'https://example.com/booking' });
  observed.reservation.mode = 'reservable';
  const report = scoreRestaurantLinks(rodeo, {
    candidate: rodeoCandidate,
    preview: observed,
  });
  assert.equal(report.pass, false);
  assert.equal(report.checks.profileBookingLink.failure, 'wrong');
  assert.equal(report.checks.reservationUrl.failure, 'wrong');
});

test('a listing may remain the policy citation only with a separately verified booking destination', () => {
  const observed = preview();
  observed.reservation.url = rodeo.expected.tabelogUrl;
  assert.equal(
    scoreRestaurantLinks(rodeo, {
      candidate: rodeoCandidate,
      preview: observed,
    }).pass,
    true,
  );
  observed.profile.bookingLink.value = rodeo.expected.tabelogUrl;
  assert.equal(
    scoreRestaurantLinks(rodeo, {
      candidate: rodeoCandidate,
      preview: observed,
    }).pass,
    false,
  );
});

test('reports missing URLs separately from present but incorrect URLs', () => {
  const missing = preview();
  delete missing.profile.bookingLink;
  const missingReport = scoreRestaurantLinks(rodeo, {
    candidate: rodeoCandidate,
    preview: missing,
  });
  assert.equal(missingReport.checks.profileBookingLink.failure, 'missing');

  const wrongReport = scoreRestaurantLinks(rodeo, {
    candidate: rodeoCandidate,
    preview: preview({ bookingUrl: 'https://example.com/wrong' }),
  });
  assert.equal(wrongReport.checks.profileBookingLink.failure, 'wrong');
});

test('exact URL with owner asserted or stale evidence is an evidence failure', () => {
  const report = scoreRestaurantLinks(rodeo, {
    candidate: rodeoCandidate,
    preview: preview({ provenance: 'owner_asserted' }),
  });
  assert.equal(report.checks.tabelog.failure, 'evidence');
  assert.equal(report.checks.reservationUrl.failure, 'evidence');
});

test('exact profile URL without its own source and timestamp is an evidence failure', () => {
  const observed = preview();
  observed.profile.bookingLink = { value: rodeo.expected.bookingUrl };
  const report = scoreRestaurantLinks(rodeo, {
    candidate: rodeoCandidate,
    preview: observed,
  });
  assert.equal(report.checks.profileBookingLink.failure, 'evidence');
});

test('does not accept an invented official website or an official social account as website', () => {
  const absentSite = {
    tabelog: {
      status: 'known',
      url: shima.expected.tabelogUrl,
      provenance: 'agent_observed',
      freshness: 'fresh',
      observedAt: '2026-10-04T00:00:00.000Z',
    },
    reservation: {
      status: 'known',
      url: shima.expected.bookingUrl,
      provenance: 'agent_observed',
      freshness: 'fresh',
      observedAt: '2026-10-04T00:00:00.000Z',
    },
    profile: {},
  };
  const candidate = {
    transientName: 'らぁ麺や 嶋',
    transientAddress: '東京都渋谷区本町3-41-12',
  };
  assert.equal(
    scoreRestaurantLinks(shima, { candidate, preview: absentSite }).checks
      .officialWebsite.pass,
    true,
  );
  for (const url of [
    'https://ramenya-shima.example.jp/',
    'https://www.instagram.com/ramenya_shima/',
    'https://x.com/ramenya_shima',
  ]) {
    const report = scoreRestaurantLinks(shima, {
      candidate,
      preview: {
        ...absentSite,
        profile: {
          officialWebsite: {
            value: url,
            sourceUrl: 'https://tabelog.com/tokyo/A1304/A130401/13247487/',
            observedAt: '2026-10-04T00:00:00.000Z',
          },
        },
      },
    });
    assert.equal(report.checks.officialWebsite.failure, 'wrong');
  }
});

test('candidate mismatch is an identity failure and missing candidate after provider error is provider failure', () => {
  const mismatch = scoreRestaurantLinks(rodeo, {
    candidate: {
      transientName: 'RODEO Shibuya',
      transientAddress: '東京都渋谷区',
    },
    preview: preview(),
  });
  assert.equal(mismatch.checks.identity.failure, 'identity');

  const unavailable = scoreRestaurantLinks(rodeo, {
    providerFailure: true,
    stage: 'discover',
  });
  assert.equal(unavailable.checks.identity.failure, 'provider');
  assert.equal(unavailable.checks.tabelog.failure, 'provider');

  const shimaMismatch = scoreRestaurantLinks(shima, {
    candidate: {
      transientName: 'Ramenya Shima',
      transientAddress:
        '3-chōme-41-11 Honmachi, Shibuya, Tokyo 151-0071, Japan',
    },
    preview: {},
  });
  assert.equal(shimaMismatch.checks.identity.failure, 'identity');
  assert.equal(shimaMismatch.diagnostics.addressMismatchForMatchingName, true);
  assert.match(
    shimaMismatch.diagnostics.addressMismatchDiagnostic.note,
    /Causality is not established/u,
  );
});
