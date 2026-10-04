import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createPlaceResearchAgent } from '../../agent/place-research.ts';
import {
  canonicalToretaBookingUrl,
  parseToretaBookingPage,
} from '../../agent/toreta-booking.ts';
import {
  parseTableCheckBookingPage,
  readTableCheckBookingPage,
} from '../../agent/tablecheck-booking.ts';

const { cases } = JSON.parse(
  readFileSync(
    new URL('./booking-destinations.v1.json', import.meta.url),
    'utf8',
  ),
);
test('TableCheck follows only one language redirect for the same merchant', async () => {
  const merchant = cases.find((sample) => sample.id === 'tablecheck');
  const original = merchant.bookingUrl.replace('/ja/shops/', '/shops/');
  for (const destination of [
    merchant.bookingUrl,
    merchant.bookingUrl.replace('fixture-noodles', 'another-shop'),
    'https://other.example/shops/fixture-noodles/reserve',
  ]) {
    const calls = [];
    const result = await readTableCheckBookingPage(
      original,
      async (url, init) => {
        calls.push(url);
        assert.equal(init.redirect, 'manual');
        return calls.length === 1
          ? new Response(null, {
              status: 302,
              headers: { location: destination },
            })
          : new Response(merchant.bookingHtml, {
              headers: { 'content-type': 'text/html' },
            });
      },
      new AbortController().signal,
    );
    assert.equal(
      result.kind,
      destination === merchant.bookingUrl ? 'read' : 'invalid_source',
    );
    assert.equal(calls.length, destination === merchant.bookingUrl ? 2 : 1);
    if (result.kind === 'read')
      assert.equal(result.evidence.url, merchant.bookingUrl);
  }
  let calls = 0;
  const loop = await readTableCheckBookingPage(
    original,
    async () => {
      calls++;
      return new Response(null, {
        status: 302,
        headers: { location: merchant.bookingUrl },
      });
    },
    new AbortController().signal,
  );
  assert.equal(loop.kind, 'unavailable');
  assert.equal(calls, 2);
});
for (const sample of cases) {
  for (const model of [
    'failure',
    'listing_as_booking',
    'wrong_branch',
    'blocked',
  ]) {
    test(`${sample.id}: independently read destination survives ${model}`, async () => {
      const codes = [];
      const listing = {
        url: sample.listingUrl,
        title: sample.name,
        content: `${sample.name} ${sample.address} 予約可 ${sample.listingUrl}`,
        restaurant: {
          name: sample.name,
          address: sample.address,
          area: 'Tokyo',
          categories: ['Restaurant'],
          reservation: sample.policy,
          ...(sample.officialWebsite
            ? { officialWebsite: sample.officialWebsite }
            : {}),
          ...(sample.providerHint
            ? { bookingProviderHint: sample.providerHint }
            : {}),
        },
      };
      const agent = createPlaceResearchAgent({
        apiKey: 'fixture',
        baseUrl: 'https://model.example/v1',
        model: 'fixture',
        searchApiKey: 'fixture',
        sourceReader: async () => ({ kind: 'read', evidence: listing }),
        onDiagnostic: (code) => codes.push(code),
        fetch: async (url) => {
          if (url === 'https://api.tavily.com/search')
            return Response.json({
              results: [
                {
                  url: sample.bookingUrl,
                  title: sample.name,
                  content: sample.name,
                },
              ],
            });
          if (url === sample.bookingUrl.replace(/#\/$/u, ''))
            return model === 'blocked'
              ? new Response('', { status: 403 })
              : new Response(
                  model === 'wrong_branch'
                    ? sample.bookingHtml.replace(/1-1-1|2-2-2/gu, '3-99-99')
                    : sample.bookingHtml,
                  { headers: { 'content-type': 'text/html' } },
                );
          if (url === sample.officialWebsite)
            return new Response('', { status: 403 });
          assert.equal(url, 'https://model.example/v1/chat/completions');
          if (model === 'failure') return new Response('', { status: 503 });
          return Response.json({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    subjectMatch: 'matched',
                    tabelog: { status: 'unknown' },
                    reservation: { status: 'unknown' },
                    profile: { bookingLink: sample.listingUrl },
                    evidence: {
                      bookingLink: {
                        url: sample.listingUrl,
                        quote: listing.content,
                      },
                    },
                  }),
                },
              },
            ],
          });
        },
      });
      const result = await agent.research({
        selectedSubject: {
          providerNamespace: 'tabelog',
          placeId: sample.listingUrl,
          transientName: sample.name,
          transientAddress: sample.address,
          ownerQuery: sample.name,
        },
      });
      assert.equal(result.kind, 'observed', JSON.stringify({ result, codes }));
      if (['wrong_branch', 'blocked'].includes(model)) {
        assert.equal(result.value.profile?.bookingLink, undefined);
        assert.equal(result.value.reservation.url, sample.listingUrl);
        return;
      }
      assert.equal(result.value.profile.bookingLink.value, sample.bookingUrl);
      assert.equal(result.value.reservation.url, sample.bookingUrl);
      assert.notEqual(
        result.value.profile.bookingLink.value,
        sample.listingUrl,
      );
      if (sample.id === 'toreta')
        assert.equal(result.value.reservation.bookingWindowLabel, undefined);
      if (model === 'listing_as_booking')
        assert.ok(codes.includes('booking_link_rejected_destination'));
    });
  }
  test(`${sample.id}: merchant reader extracts the branch address independently of timing`, () => {
    const parse =
      sample.id === 'toreta'
        ? parseToretaBookingPage
        : parseTableCheckBookingPage;
    const result = parse(sample.bookingHtml, sample.bookingUrl);
    assert.equal(result.booking.name, sample.name);
    assert.ok(result.booking.address);
  });
}

test('Toreta routes preserve fragments and reject credentials, other hosts and query URLs', () => {
  assert.equal(
    canonicalToretaBookingUrl('https://yoyaku.toreta.in/fixture-kitchen'),
    cases[0].bookingUrl,
  );
  for (const url of [
    'http://yoyaku.toreta.in/fixture-kitchen/',
    'https://yoyaku.toreta.in.evil.test/fixture-kitchen/',
    'https://owner@yoyaku.toreta.in/fixture-kitchen/',
    'https://yoyaku.toreta.in/fixture-kitchen/?token=x',
  ])
    assert.equal(canonicalToretaBookingUrl(url), undefined);
});
