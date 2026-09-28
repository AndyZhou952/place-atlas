import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createPlaceResearchAgent } from '../../agent/place-research.ts';

const dataset = JSON.parse(
  readFileSync(
    new URL('./official-site-fallback.v1.json', import.meta.url),
    'utf8',
  ),
);

for (const row of dataset.cases.filter((candidate) => candidate.sourceUnit)) {
  test(`official site fallback: ${row.id}`, async () => {
    const requests = [];
    const identity = `Burnt Ends Restaurant 7 Dempsey Road ${row.sourceUnit} Singapore 249671`;
    const fact = `${identity}. Reservations available.`;
    const agent = createPlaceResearchAgent({
      apiKey: 'fixture',
      baseUrl: 'https://model.example/v1',
      model: 'fixture',
      officialWebsiteForPlaceId: async (placeId) => {
        assert.equal(placeId, 'ChIJLZ9DYnIZ2jERQ51Am7WzJLM');
        return 'https://burntends.com.sg/';
      },
      fetch: async (url) => {
        requests.push(url);
        if (url === 'https://burntends.com.sg/')
          return new Response(
            '<title>Burnt Ends</title><a href="/contact/">Contact</a><a href="/reservations/">Reservations</a><p>Burnt Ends Singapore restaurant.</p>',
            { headers: { 'content-type': 'text/html' } },
          );
        if (url === 'https://burntends.com.sg/contact/')
          return new Response(`<title>Contact</title><p>${identity}.</p>`, {
            headers: { 'content-type': 'text/html' },
          });
        if (url === 'https://burntends.com.sg/reservations/')
          return new Response(`<title>Reservations</title><p>${fact}</p>`, {
            headers: { 'content-type': 'text/html' },
          });
        if (url.startsWith('https://html.duckduckgo.com/html'))
          return new Response('blocked', { status: 403 });
        assert.equal(url, 'https://model.example/v1/chat/completions');
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  subjectMatch: 'matched',
                  tabelog: { status: 'unknown' },
                  reservation: {
                    status: 'known',
                    mode: 'reservable',
                    label: 'Reservations available.',
                    url: 'https://burntends.com.sg/reservations/',
                  },
                  evidence: {
                    reservation: {
                      url: 'https://burntends.com.sg/reservations/',
                      quote: 'Reservations available.',
                      identityQuote: identity,
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
        ownerQuery: 'Burnt Ends Singapore Dempsey',
        providerNamespace: 'google-places',
        placeId: 'ChIJLZ9DYnIZ2jERQ51Am7WzJLM',
        transientName: 'Burnt Ends',
        transientAddress: '7 Dempsey Rd, #01-02, Singapore 249671',
      },
    });
    assert.equal(
      result.kind,
      row.expectReservation ? 'observed' : 'unavailable',
    );
    if (result.kind === 'observed')
      assert.equal(result.value.reservation.status, 'known');
    assert.equal(
      requests.some((url) =>
        url.startsWith('https://html.duckduckgo.com/html'),
      ),
      !row.expectReservation,
    );
  });
}

for (const row of dataset.cases.filter((candidate) => candidate.identityUnit)) {
  test(`official site fallback: ${row.id}`, async () => {
    const identity = `Burnt Ends Restaurant 7 Dempsey Road #01-02 Singapore 249671`;
    const barIdentity = `Burnt Ends Cocktail Bar 7 Dempsey Road #01-04 Singapore 249671`;
    const fact = 'Burnt Ends Restaurant serves modern Australian barbecue.';
    const booking = 'Reserve Now: https://burntends.com.sg/reservations/';
    const pages = new Map([
      [
        'https://burntends.com.sg/',
        '<title>Burnt Ends</title><a href="/burnt-ends-restaurant/">Burnt Ends Restaurant</a><a href="/contact/">Contact</a><a href="/reservations/">Reservations</a><p>Official hospitality site.</p>',
      ],
      [
        'https://burntends.com.sg/burnt-ends-restaurant/',
        `<title>Burnt Ends Restaurant - Burnt Ends</title><p>${fact}</p><a href="/reservations/">Reserve Now</a>`,
      ],
      [
        'https://burntends.com.sg/contact/',
        `<title>Contact</title><p>${identity}. ${barIdentity}.</p>`,
      ],
      [
        'https://burntends.com.sg/reservations/',
        '<title>Reservations</title><p>Restaurant and bar seating hours.</p>',
      ],
    ]);
    const agent = createPlaceResearchAgent({
      apiKey: 'fixture',
      baseUrl: 'https://model.example/v1',
      model: 'fixture',
      officialWebsiteForPlaceId: async () => 'https://burntends.com.sg/',
      fetch: async (url) => {
        if (pages.has(url))
          return new Response(pages.get(url), {
            headers: { 'content-type': 'text/html' },
          });
        assert.equal(url, 'https://model.example/v1/chat/completions');
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  subjectMatch: 'matched',
                  tabelog: { status: 'unknown' },
                  reservation: { status: 'unknown' },
                  profile: {
                    categories: ['modern Australian barbecue'],
                    bookingLink: 'https://burntends.com.sg/reservations/',
                  },
                  evidence: {
                    categories: {
                      url: 'https://burntends.com.sg/burnt-ends-restaurant/',
                      quote: fact,
                      identityUrl: 'https://burntends.com.sg/contact/',
                      identityQuote:
                        row.identityUnit === '#01-02' ? identity : barIdentity,
                    },
                    bookingLink: {
                      url: 'https://burntends.com.sg/burnt-ends-restaurant/',
                      quote: booking,
                      identityUrl: 'https://burntends.com.sg/contact/',
                      identityQuote:
                        row.identityUnit === '#01-02' ? identity : barIdentity,
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
        ownerQuery: 'Burnt Ends Singapore Dempsey',
        providerNamespace: 'google-places',
        placeId: 'ChIJLZ9DYnIZ2jERQ51Am7WzJLM',
        transientName: 'Burnt Ends',
        transientAddress: '7 Dempsey Rd, #01-02, Singapore 249671',
      },
    });
    assert.equal(result.kind, 'observed');
    assert.equal(
      result.value.profile?.categories?.value?.[0],
      row.expectCategory ? 'modern Australian barbecue' : undefined,
    );
    assert.equal(
      result.value.profile?.bookingLink?.value,
      row.expectBooking ? 'https://burntends.com.sg/reservations/' : undefined,
    );
    assert.equal(
      result.value.reservation.status,
      row.expectBooking ? 'known' : 'unknown',
    );
  });
}
