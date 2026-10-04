import assert from 'node:assert/strict';
import test from 'node:test';

import { createPlaceResearchAgent } from './place-research.ts';

const subject = {
  ownerQuery: '焼鳥 にしき 湯島',
  providerNamespace: 'google-places',
  placeId: 'google-yushima-branch',
  transientName: '焼鳥 にしき',
  transientAddress: '東京都文京区湯島3-36-12',
};
const input = {
  phase: 'initial',
  selectedSubject: subject,
  scope: { ownerId: 'owner', channel: 'web', conversationId: 'hours-test' },
  sessionId: 'hours-session',
  expectedSessionVersion: 1,
  queryOrUrlsDigest: 'unused',
};
const listingUrl = 'https://tabelog.com/tokyo/A1311/A131101/13297763/';
const modelTool = {
  id: 'search-listing',
  type: 'function',
  function: {
    name: 'search_web',
    arguments: JSON.stringify({ query: '焼鳥 にしき 湯島 食べログ' }),
  },
};
const selectedBranch = {
  name: '焼鳥 にしき',
  address: '東京都文京区湯島3-36-12 TSKビル 1F',
  area: '東京都文京区湯島',
  categories: ['焼き鳥'],
};

test('Tabelog schedule takes precedence over a conflicting Google schedule', async () => {
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
  assert.equal(result.value.profile.openingHours.value, listingSchedule());
  assert.equal(result.value.profile.openingHours.sourceUrl, listingUrl);
  assert.equal(result.value.profile.regularClosingDays.value, '日曜日、祝日');
  assert.equal(result.value.profile.regularClosingDays.sourceUrl, listingUrl);
  assert.equal(googleScheduleCalls, 0);
});

test('Google schedule fills hours when the verified Tabelog listing has none', async () => {
  const result = await research({
    listing: selectedBranch,
    googleSchedule: async (placeId) => {
      assert.equal(placeId, subject.placeId);
      return {
        name: selectedBranch.name,
        address: selectedBranch.address,
        sourceUrl: 'https://maps.google.com/?cid=google-hours',
        openingHours: '月曜日: 定休日\n火曜日: 17:00 - 23:00',
        regularClosingDays: '月曜日: 定休日',
      };
    },
  });

  assert.equal(result.kind, 'observed');
  assert.equal(
    result.value.profile.openingHours.value,
    '月曜日: 定休日\n火曜日: 17:00 - 23:00',
  );
  assert.equal(
    result.value.profile.openingHours.sourceUrl,
    'https://maps.google.com/?cid=google-hours',
  );
  assert.equal(result.value.profile.regularClosingDays.value, '月曜日: 定休日');
});

function listingSchedule() {
  return '月〜土 18:00 - 22:30; 日・祝 定休日';
}

test('a branch-verified Google fallback retains sourced identity when listing and model are unavailable', async () => {
  const schedule = {
    name: selectedBranch.name,
    address: selectedBranch.address,
    sourceUrl: 'https://maps.google.com/?cid=google-hours',
    openingHours: '月曜日: 定休日\n火曜日: 17:00 - 23:00',
    regularClosingDays: '月曜日: 定休日',
  };
  const result = await research({
    listing: selectedBranch,
    googleSchedule: async () => schedule,
    sourceUnavailable: true,
    modelUnavailable: true,
  });
  assert.equal(result.kind, 'observed');
  for (const field of [
    'name',
    'address',
    'openingHours',
    'regularClosingDays',
  ]) {
    assert.equal(result.value.profile[field].value, schedule[field]);
    assert.equal(result.value.profile[field].sourceUrl, schedule.sourceUrl);
  }
  assert.equal(result.value.tabelog.status, 'unknown');
  assert.equal(result.value.reservation.status, 'unknown');
});

test('branch-verified official closure policy fills an absent Tabelog field and beats Google', async () => {
  const officialUrl = 'https://gonokamiseisakusho.com/shinjyuku.html';
  const officialRecord = {
    '@type': 'Restaurant',
    url: officialUrl,
    name: 'つけ麺 五ノ神製作所',
    address: {
      addressRegion: '東京都',
      addressLocality: '渋谷区',
      streetAddress: '千駄ヶ谷5-33-16',
    },
    openingHoursSpecification: [
      {
        dayOfWeek: [
          'Monday',
          'Tuesday',
          'Wednesday',
          'Thursday',
          'Friday',
          'Saturday',
          'Sunday',
        ],
        opens: '11:00',
        closes: '21:30',
      },
    ],
  };
  const result = await research({
    selectedSubject: {
      ...subject,
      ownerQuery: 'つけ麺 五ノ神製作所 千駄ヶ谷',
      transientName: 'つけ麺 五ノ神製作所',
      transientAddress: '東京都渋谷区千駄ヶ谷5-33-16 シャトレー新宿御苑第一 1F',
    },
    listing: {
      ...selectedBranch,
      name: 'つけ麺 五ノ神製作所',
      address: '東京都渋谷区千駄ヶ谷5-33-16 シャトレー新宿御苑第一 1F',
      officialWebsite: officialUrl,
      openingHours: '11:00 - 21:30',
    },
    googleSchedule: async () => ({
      name: 'つけ麺 五ノ神製作所',
      address: '東京都渋谷区千駄ヶ谷5-33-16',
      sourceUrl: 'https://maps.google.com/?cid=conflicting-hours',
      openingHours: '毎日 11:00 - 22:00',
      regularClosingDays: '火曜日',
    }),
    officialHtml: `<title>つけ麺 五ノ神製作所</title><p>東京都渋谷区千駄ヶ谷5-33-16</p><table><tr><th>定休日</th><td>無し</td></tr></table><script type="application/ld+json">${JSON.stringify(officialRecord)}</script>`,
  });

  assert.equal(result.kind, 'observed');
  assert.equal(result.value.profile.regularClosingDays.value, '無し');
  assert.equal(result.value.profile.regularClosingDays.sourceUrl, officialUrl);
});

async function research({
  selectedSubject = subject,
  listing,
  googleSchedule,
  officialHtml,
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
                    }),
                  },
          },
        ],
      });
    },
  });
  return agent.research({ ...input, selectedSubject });
}
