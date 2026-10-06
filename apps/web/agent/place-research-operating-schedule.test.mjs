import assert from 'node:assert/strict';
import test from 'node:test';

import { createPlaceResearchAgent } from './place-research.ts';

const japanSubject = {
  ownerQuery: '検証用焼鳥 湯島',
  providerNamespace: 'google-places',
  placeId: 'google-yushima-branch',
  transientName: '検証用焼鳥',
  transientAddress: '東京都文京区湯島3-36-12',
};
const selectedBranch = {
  name: '検証用焼鳥',
  address: '東京都文京区湯島3-36-12 TSKビル 1F',
  area: '東京都文京区湯島',
  categories: ['焼き鳥'],
};
const listingUrl = 'https://tabelog.com/tokyo/A1311/A131101/13000003/';
const modelTool = {
  id: 'search-listing',
  type: 'function',
  function: {
    name: 'search_web',
    arguments: JSON.stringify({ query: '検証用焼鳥 湯島 食べログ' }),
  },
};

test('Japan schedule fields come from the verified Tabelog row and skip Google', async () => {
  let googleScheduleCalls = 0;
  const result = await research({
    listing: {
      ...selectedBranch,
      openingHours: '月〜土 18:00 - 22:30; 日・祝 定休日',
      regularClosingDays: '日曜日、祝日',
    },
    googleSchedule: async () => {
      googleScheduleCalls++;
      return {
        name: selectedBranch.name,
        address: selectedBranch.address,
        sourceUrl: 'https://maps.google.com/?cid=google-hours',
        openingHours: 'Every day: 17:00 - 23:00',
        regularClosingDays: '火曜日',
      };
    },
  });

  assert.equal(result.kind, 'observed');
  assert.equal(
    result.value.profile.openingHours.value,
    '月〜土 18:00–22:30\n日・祝日 定休日',
  );
  assert.equal(result.value.profile.openingHours.sourceUrl, listingUrl);
  assert.equal(result.value.profile.regularClosingDays.value, '日曜日、祝日');
  assert.equal(result.value.profile.regularClosingDays.sourceUrl, listingUrl);
  assert.equal(googleScheduleCalls, 0);
});

test('Japan keeps schedules unknown when Tabelog omits them despite official and model claims', async () => {
  const officialUrl = 'https://noodles.example/selected';
  const name = '検証用麺処';
  const address = '東京都渋谷区千駄ヶ谷5-33-16';
  const hours = '11:00～21:30(L.O 21:00)';
  const identityQuote = `${name} ${address}`;
  const result = await research({
    selectedSubject: {
      ...japanSubject,
      ownerQuery: `${name} 千駄ヶ谷`,
      transientName: name,
      transientAddress: `${address} シャトレー新宿御苑第一 1F`,
    },
    listing: {
      ...selectedBranch,
      name,
      address: `${address} シャトレー新宿御苑第一 1F`,
      officialWebsite: officialUrl,
    },
    googleSchedule: async () => ({
      name,
      address,
      sourceUrl: 'https://maps.google.com/?cid=conflicting-hours',
      openingHours: 'Every day: 11:00 - 22:00',
      regularClosingDays: '火曜日',
    }),
    officialHtml: `<title>${name}</title><p>${identityQuote}</p><table><tr><td>営業時間</td><td>${hours}</td></tr><tr><td>定休日</td><td>無し</td></tr></table>`,
    modelProposal: {
      profile: {
        openingHours: hours,
        regularClosingDays: '無し',
        closingNotes: '年末年始',
      },
      evidence: {
        openingHours: {
          url: officialUrl,
          quote: hours,
          identityQuote,
        },
        regularClosingDays: {
          url: officialUrl,
          quote: '無し',
          identityQuote,
        },
        closingNotes: {
          url: officialUrl,
          quote: '年末年始',
          identityQuote,
        },
      },
    },
  });

  assert.equal(result.kind, 'observed');
  assert.equal(result.value.profile.openingHours, undefined);
  assert.equal(result.value.profile.regularClosingDays, undefined);
  assert.equal(result.value.profile.closingNotes, undefined);
});

test('non-Japanese schedule fields come from the selected Google Maps place', async () => {
  const overseasSubject = {
    ownerQuery: 'Fixture Grill Singapore',
    providerNamespace: 'google-places',
    placeId: 'google-fixture-grill',
    transientName: 'Fixture Grill',
    transientAddress: '1 Example Road, Singapore',
  };
  const schedule = {
    name: 'Fixture Grill',
    address: '1 Example Road, Singapore',
    sourceUrl: 'https://maps.google.com/?cid=fixture-grill',
    openingHours: 'Monday: 12:00–14:00, 18:00–22:00',
    regularClosingDays: 'Tuesday',
  };
  const result = await research({
    selectedSubject: overseasSubject,
    listing: {
      name: overseasSubject.transientName,
      address: overseasSubject.transientAddress,
      area: 'Singapore',
    },
    googleSchedule: async (placeId) => {
      assert.equal(placeId, overseasSubject.placeId);
      return schedule;
    },
    sourceUnavailable: true,
    modelUnavailable: true,
  });

  assert.equal(result.kind, 'observed');
  for (const field of ['openingHours', 'regularClosingDays']) {
    assert.equal(result.value.profile[field].value, schedule[field]);
    assert.equal(result.value.profile[field].sourceUrl, schedule.sourceUrl);
  }
  assert.equal(result.value.tabelog.status, 'unknown');
  assert.equal(result.value.reservation.status, 'unknown');
});

test('Google schedule provider failure does not discard other verified overseas research', async () => {
  const overseasSubject = {
    ownerQuery: 'Fixture Grill Singapore',
    providerNamespace: 'google-places',
    placeId: 'google-fixture-grill',
    transientName: 'Fixture Grill',
    transientAddress: '1 Example Road, Singapore',
  };
  const result = await research({
    selectedSubject: overseasSubject,
    listing: {
      name: 'Fixture Grill',
      address: overseasSubject.transientAddress,
      area: 'Singapore',
    },
    googleSchedule: async () => {
      throw new Error('Google unavailable');
    },
    modelUnavailable: true,
  });

  assert.equal(result.kind, 'observed');
  assert.equal(result.value.profile.name.value, 'Fixture Grill');
  assert.equal(result.value.profile.openingHours, undefined);
});

async function research({
  selectedSubject = japanSubject,
  listing,
  googleSchedule,
  officialHtml,
  modelProposal,
  sourceUnavailable = false,
  modelUnavailable = false,
}) {
  let modelTurn = 0;
  const agent = createPlaceResearchAgent({
    apiKey: 'test',
    baseUrl: 'https://model.example/v1',
    model: 'test-model',
    searchApiKey: 'search-test',
    readSourcePages: true,
    sourceReader: async (url) =>
      sourceUnavailable
        ? { kind: 'unavailable', reason: 'network_error' }
        : {
            kind: 'read',
            evidence: {
              url,
              title: listing.name,
              content: `${listing.name} ${listing.address}`,
              restaurant: listing,
            },
          },
    operatingScheduleForPlaceId: googleSchedule,
    fetch: async (endpoint) => {
      if (endpoint === listing.officialWebsite && officialHtml)
        return new Response(officialHtml, {
          headers: { 'content-type': 'text/html' },
        });
      if (endpoint === 'https://api.tavily.com/search')
        return Response.json({
          results: [
            {
              url: listingUrl,
              title: selectedBranch.name,
              content: `${selectedBranch.name} ${selectedBranch.address}`,
            },
          ],
        });
      if (modelUnavailable) throw new Error('model unavailable');
      return Response.json({
        choices: [
          {
            message:
              modelTurn++ === 0
                ? { tool_calls: [modelTool], content: null }
                : {
                    content: JSON.stringify({
                      subjectMatch: 'matched',
                      tabelog: { status: 'unknown' },
                      reservation: { status: 'unknown' },
                      ...modelProposal,
                    }),
                  },
          },
        ],
      });
    },
  });
  return agent.research({
    phase: 'initial',
    selectedSubject,
    scope: { ownerId: 'owner', channel: 'web', conversationId: 'hours-test' },
    sessionId: 'hours-session',
    expectedSessionVersion: 1,
    queryOrUrlsDigest: 'unused',
  });
}
