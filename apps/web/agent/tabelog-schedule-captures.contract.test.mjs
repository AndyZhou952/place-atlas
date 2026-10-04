import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { scoreCatalogHoursCase } from '../evals/add-behavior/catalog-hours-score.mjs';
import {
  parseTabelogListing,
  readTabelogListingResult,
} from './tabelog-listing.ts';

const captures = JSON.parse(
  readFileSync(
    new URL(
      '../evals/add-behavior/catalog-hours-captures.v1.json',
      import.meta.url,
    ),
    'utf8',
  ),
).cases;
const inventory = JSON.parse(
  readFileSync(
    new URL(
      '../evals/add-behavior/catalog-hours-inventory.v1.json',
      import.meta.url,
    ),
    'utf8',
  ),
).cases;
const gold = JSON.parse(
  readFileSync(
    new URL('../evals/add-behavior/catalog-hours.v1.json', import.meta.url),
    'utf8',
  ),
).cases;
const goldById = new Map(gold.map((item) => [item.itemId, item]));

test('all 55 independently captured exact listings supply bounded hours through the production reader', async () => {
  assert.equal(captures.length, 55);
  assert.deepEqual(
    new Set(captures.map((c) => c.itemId)),
    new Set(inventory.filter((c) => c.listingUrl).map((c) => c.itemId)),
  );
  const scheduleMismatches = [];
  for (const sample of captures) {
    const result = await readTabelogListingResult(
      sample.listingUrl,
      async () =>
        new Response(sample.html, { headers: { 'content-type': 'text/html' } }),
      AbortSignal.timeout(1000),
    );
    assert.equal(result.kind, 'read', sample.name);
    assert.ok(result.evidence.restaurant.openingHours, sample.name);
    assert.ok(
      result.evidence.restaurant.openingHours.length <= 1200,
      sample.name,
    );
    assert.match(
      result.evidence.restaurant.openingHours,
      /\d{1,2}:\d{2}|24時間営業/u,
      sample.name,
    );
    const expected = goldById.get(sample.itemId);
    assert.ok(expected, `${sample.name}: missing canonical hours case`);
    const hoursOnlyScore = scoreCatalogHoursCase(expected, {
      openingHours: {
        value: result.evidence.restaurant.openingHours,
        sourceUrl: sample.listingUrl,
        observedAt: expected.openingHours?.observedAt,
      },
      regularClosingDays: undefined,
      closingNotes: undefined,
    });
    if (!hoursOnlyScore.checks.openingHours.pass)
      scheduleMismatches.push(
        `${sample.name} (${hoursOnlyScore.checks.openingHours.failure})`,
      );
  }
  assert.deepEqual(
    scheduleMismatches,
    [],
    'reader opening-hours facts differ from gold',
  );
});

test('a sister-branch advertisement cannot replace the selected restaurant schedule or closing notes', () => {
  const sample = captures.find((c) => c.name === '東京肉しゃぶ家');
  const facts = parseTabelogListing(sample.html, sample.listingUrl).restaurant;
  assert.match(facts.openingHours, /17:00 - 22:30/u);
  assert.equal(facts.regularClosingDays, '月');
  assert.doesNotMatch(facts.openingHours, /銀座|秀彬|12:00|14:30/u);
  assert.equal(facts.closingNotes, undefined);
});

test('captured weekly policies and calendar notes match independent same-listing claims', () => {
  const mismatches = [];
  for (const sample of captures) {
    const expected = goldById.get(sample.itemId);
    const facts = parseTabelogListing(
      sample.html,
      sample.listingUrl,
    ).restaurant;
    const profile = Object.fromEntries(
      ['openingHours', 'regularClosingDays', 'closingNotes']
        .filter((field) => facts[field])
        .map((field) => [
          field,
          {
            value: facts[field],
            sourceUrl: sample.listingUrl,
            observedAt: expected.observedAt,
          },
        ]),
    );
    const score = scoreCatalogHoursCase(expected, profile);
    for (const field of ['regularClosingDays', 'closingNotes']) {
      // External branch sources are exercised by their own readers; absence
      // from this Tabelog capture is not an extraction failure.
      if (expected[field] && expected[field].sourceUrl !== sample.listingUrl)
        continue;
      if (!score.checks[field].pass)
        mismatches.push(
          `${sample.name}/${field}: ${score.checks[field].failure}`,
        );
    }
  }
  assert.deepEqual(mismatches, []);
});

test('a secondary-floor café closure retains its scope instead of closing the main shop', () => {
  const sample = captures.find((c) => c.name === 'シュトラウス');
  const facts = parseTabelogListing(sample.html, sample.listingUrl).restaurant;
  assert.equal(facts.regularClosingDays, '2Fカフェサロン：月曜日');
  assert.match(facts.openingHours, /月・火・水・木・金・土・日/u);
});

test('same-listing FAQ can corroborate bare hours but cannot override conflicting current clocks', () => {
  const sample = captures.find((c) => c.name === '喫茶 月森');
  const facts = parseTabelogListing(sample.html, sample.listingUrl).restaurant;
  assert.match(facts.openingHours, /\[月\]/u);
  assert.equal(
    facts.regularClosingDays,
    undefined,
    'daily hours never imply no fixed rest days',
  );
  const wrongClock = sample.html.replaceAll('11:00 - 20:00', '11:00 - 21:00');
  // Replace only the hours FAQ, retaining the visible branch business row.
  const changed =
    sample.html.slice(0, sample.html.lastIndexOf('<script')) +
    wrongClock.slice(wrongClock.lastIndexOf('<script'));
  const checked = parseTabelogListing(changed, sample.listingUrl).restaurant;
  assert.match(checked.openingHours, /11:00 - 20:00/u);
  assert.doesNotMatch(checked.openingHours, /21:00/u);
});

test('seasonal closure notes stay separate from unknown weekly closure policies', () => {
  const sample = captures.find((c) => c.name === 'RODEO');
  const facts = parseTabelogListing(sample.html, sample.listingUrl).restaurant;
  assert.equal(facts.regularClosingDays, undefined);
  assert.equal(facts.closingNotes, '年末年始');
});

test('a FAQ with the same clocks cannot swap structured single-day business rows', () => {
  const sample = captures.find((c) => c.name === '喫茶 月森');
  const html =
    sample.html.replace(
      /<th[^>]*>営業時間[\s\S]*?<\/tr>/u,
      '<th>営業時間</th><td><p class="rstinfo-table__business-title">月</p><ul><li>11:00 - 20:00</li></ul><p class="rstinfo-table__business-title">火</p><ul><li>12:00 - 21:00</li></ul></td></tr>',
    ) +
    `<script type="application/ld+json">${JSON.stringify({ '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: '営業時間・定休日を教えてください', acceptedAnswer: { text: `[月]12:00 - 21:00 [火]11:00 - 20:00 <a href="${sample.listingUrl}">店舗情報</a>` } }] })}</script>`;
  const facts = parseTabelogListing(html, sample.listingUrl).restaurant;
  assert.match(facts.openingHours, /月 11:00 - 20:00/u);
  assert.match(facts.openingHours, /火 12:00 - 21:00/u);
  assert.doesNotMatch(facts.openingHours, /\[月\]/u);
});
