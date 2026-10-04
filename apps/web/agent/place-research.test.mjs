import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  createPlaceResearchAgent,
  createConfiguredPlaceResearchAgent,
} from './place-research.ts';

const subject = {
  ownerQuery: 'Aldebaran 麻布十番',
  providerNamespace: 'google-places',
  placeId: 'example',
  transientName: 'アルデバラン',
  transientAddress: '東京都港区麻布十番',
};
const input = {
  phase: 'initial',
  selectedSubject: subject,
  scope: { ownerId: 'owner', channel: 'web', conversationId: 'test' },
  sessionId: 'session',
  expectedSessionVersion: 1,
  queryOrUrlsDigest: 'unused',
};
const url = 'https://tabelog.com/tokyo/A1307/A130702/13212345/';
const config = {
  apiKey: 'test',
  baseUrl: 'https://model.example/v1',
  model: 'test-model',
  searchApiKey: 'search-test',
  readSourcePages: false,
};
const content = 'アルデバラン 東京都港区麻布十番 食べログ 3.97 予約可';
const proposal = {
  subjectMatch: 'matched',
  tabelog: { status: 'known', score: 3.97, url },
  reservation: { status: 'unknown' },
  evidence: {
    identity: { url, quote: 'アルデバラン 東京都港区麻布十番' },
    tabelog: { url, quote: '食べログ 3.97' },
  },
};
const tool = {
  id: 'search1',
  type: 'function',
  function: {
    name: 'search_web',
    arguments: JSON.stringify({ query: 'アルデバラン 麻布十番 食べログ' }),
  },
};

test('an all-not-stated reservation is unknown even with a copied source quote', async () => {
  const invalid = structuredClone(proposal);
  invalid.reservation = {
    status: 'known',
    mode: 'not_stated',
    label: 'not_stated',
    url,
  };
  invalid.evidence.reservation = { url, quote: '予約可' };
  assert.equal(
    (await harness(invalid).agent.research(input)).value.reservation.status,
    'unknown',
  );
});

function harness(final = proposal, sourceUrl = url) {
  const requests = [];
  let turn = 0;
  return {
    requests,
    agent: createPlaceResearchAgent({
      ...config,
      fetch: async (endpoint, init) => {
        requests.push({ endpoint, body: JSON.parse(init.body) });
        if (endpoint === 'https://api.tavily.com/search')
          return Response.json({
            results: [{ url: sourceUrl, title: 'アルデバラン', content }],
          });
        assert.equal(endpoint, 'https://model.example/v1/chat/completions');
        return Response.json({
          choices: [
            {
              message:
                turn++ === 0
                  ? { tool_calls: [tool], content: null }
                  : { content: JSON.stringify(final) },
            },
          ],
        });
      },
    }),
  };
}

test('research executes fixed search tool then produces validated sourced preview facts', async () => {
  const { agent, requests } = harness();
  const result = await agent.research(input);
  assert.equal(result.kind, 'observed');
  assert.equal(result.value.tabelog.score, 3.97);
  assert.equal(result.value.tabelog.provenance, 'agent_observed');
  assert.equal(requests.length, 3);
  assert.match(requests[0].body.messages[0].content, /official website/u);
  assert.match(
    requests[0].body.tools[0].function.description,
    /never full pages/u,
  );
});

test('a denied listing is surfaced even when search snippets support some facts', async () => {
  let turn = 0;
  const agent = createPlaceResearchAgent({
    ...config,
    readSourcePages: true,
    fetch: async (endpoint) => {
      if (endpoint === url) return new Response('denied', { status: 403 });
      if (endpoint === 'https://api.tavily.com/search')
        return Response.json({
          results: [{ url, title: 'アルデバラン', content }],
        });
      return Response.json({
        choices: [
          {
            message:
              turn++ === 0
                ? { tool_calls: [tool], content: null }
                : { content: JSON.stringify(proposal) },
          },
        ],
      });
    },
  });
  const result = await agent.research(input);
  assert.equal(result.kind, 'observed');
  assert.equal(result.sourceAccessIssue, 'blocked');
  assert.equal(
    result.value.tabelog.score,
    3.97,
    'retain independently supported evidence',
  );
  assert.equal(result.value.reservation.status, 'unknown');
});

test('a sourced individual review score is not accepted as a restaurant aggregate', async () => {
  const reviewUrl = `${url}dtlrvwlst/B123/`;
  const review = structuredClone(proposal);
  review.tabelog.url = reviewUrl;
  review.evidence.identity.url = reviewUrl;
  review.evidence.tabelog.url = reviewUrl;
  const result = await harness(review, reviewUrl).agent.research(input);
  assert.equal(result.kind, 'observed');
  assert.equal(result.value.tabelog.status, 'unknown');
});

test('invented evidence and another branch are not saved as known facts', async () => {
  const forged = structuredClone(proposal);
  forged.evidence.tabelog.quote = '食べログ 4.99';
  forged.tabelog.score = 4.99;
  assert.equal(
    (await harness(forged).agent.research(input)).value.tabelog.status,
    'unknown',
  );
  assert.equal(
    (
      await harness({ ...proposal, subjectMatch: 'uncertain' }).agent.research(
        input,
      )
    ).value.tabelog.status,
    'unknown',
  );
});

test('unsupported tools and provider failures return unavailable with no writes', async () => {
  const agent = createPlaceResearchAgent({
    ...config,
    fetch: async () =>
      Response.json({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  ...tool,
                  function: { name: 'write_database', arguments: '{}' },
                },
              ],
            },
          },
        ],
      }),
  });
  assert.deepEqual(await agent.research(input), { kind: 'unavailable' });
  const unavailable = createPlaceResearchAgent({
    ...config,
    fetch: async () => new Response('', { status: 429 }),
  });
  assert.deepEqual(await unavailable.research(input), { kind: 'unavailable' });
});

test('search budget stops repeated tool calls after two searches', async () => {
  let searches = 0;
  const agent = createPlaceResearchAgent({
    ...config,
    fetch: async (endpoint) => {
      if (endpoint === 'https://api.tavily.com/search') {
        searches++;
        return Response.json({ results: [] });
      }
      return Response.json({
        choices: [
          { message: { tool_calls: [{ ...tool, id: `call-${searches}` }] } },
        ],
      });
    },
  });
  assert.deepEqual(await agent.research(input), { kind: 'unavailable' });
  assert.equal(searches, 2);
});

test('DeepSeek multiple tool_calls receive matching sequential results in one turn', async () => {
  let searches = 0;
  let turns = 0;
  const calls = [tool, { ...tool, id: 'search2' }];
  const agent = createPlaceResearchAgent({
    ...config,
    fetch: async (endpoint, init) => {
      if (endpoint === 'https://api.tavily.com/search') {
        searches++;
        return Response.json({
          results: [{ url, title: 'アルデバラン', content }],
        });
      }
      const body = JSON.parse(init.body);
      if (turns++ === 0)
        return Response.json({
          choices: [
            {
              finish_reason: 'tool_calls',
              message: { role: 'assistant', content: null, tool_calls: calls },
            },
          ],
        });
      assert.deepEqual(
        body.messages
          .filter((message) => message.role === 'tool')
          .map((message) => message.tool_call_id),
        ['search1', 'search2'],
      );
      return Response.json({
        choices: [{ message: { content: JSON.stringify(proposal) } }],
      });
    },
  });
  assert.equal((await agent.research(input)).value.tabelog.score, 3.97);
  assert.equal(searches, 2);
  assert.equal(turns, 2);
});

test('invalid multi-call batches do not execute a partial search', async () => {
  for (const second of [
    tool,
    {
      ...tool,
      id: 'bad',
      function: { name: 'write_database', arguments: '{}' },
    },
  ]) {
    let searches = 0;
    const agent = createPlaceResearchAgent({
      ...config,
      fetch: async (endpoint) => {
        if (endpoint === 'https://api.tavily.com/search') {
          searches++;
          return Response.json({ results: [] });
        }
        return Response.json({
          choices: [{ message: { tool_calls: [tool, second] } }],
        });
      },
    });
    assert.deepEqual(await agent.research(input), { kind: 'unavailable' });
    assert.equal(searches, 0);
  }
});

test('one failed search preserves independently supported facts in either batch order', async () => {
  for (const failedSearch of [1, 2]) {
    let searches = 0;
    let turns = 0;
    const agent = createPlaceResearchAgent({
      ...config,
      fetch: async (endpoint, init) => {
        if (endpoint === 'https://api.tavily.com/search') {
          if (++searches === failedSearch)
            return new Response('', { status: 503 });
          return Response.json({ results: [{ url, content }] });
        }
        if (turns++ === 0)
          return Response.json({
            choices: [
              { message: { tool_calls: [tool, { ...tool, id: 'search2' }] } },
            ],
          });
        const replies = JSON.parse(init.body).messages.filter(
          (m) => m.role === 'tool',
        );
        assert.equal(replies.length, 2);
        assert.equal(
          JSON.parse(replies[failedSearch - 1].content).kind,
          'unavailable',
        );
        return Response.json({
          choices: [{ message: { content: JSON.stringify(proposal) } }],
        });
      },
    });
    const result = await agent.research(input);
    assert.equal(result.kind, 'observed');
    assert.equal(result.value.tabelog.score, 3.97);
    assert.equal(result.value.reservation.status, 'unknown');
    assert.equal(searches, 2);
  }
});

test('discovered main listing supplies aggregate evidence missing from search snippets', async () => {
  let turns = 0;
  let reads = 0;
  const observed = structuredClone(proposal);
  observed.evidence.tabelog.quote = 'Tabelog aggregate restaurant rating: 3.97';
  const agent = createPlaceResearchAgent({
    ...config,
    readSourcePages: true,
    fetch: async (endpoint, init) => {
      if (endpoint === 'https://api.tavily.com/search')
        return Response.json({
          results: [{ url, content: 'Find this restaurant on Tabelog.' }],
        });
      if (endpoint === url) {
        reads++;
        return new Response(
          `<script type="application/ld+json">${JSON.stringify({
            '@type': 'Restaurant',
            '@id': url,
            name: 'アルデバラン',
            address: {
              addressRegion: '東京都',
              addressLocality: '港区',
              streetAddress: '麻布十番',
            },
            aggregateRating: {
              '@type': 'AggregateRating',
              ratingValue: '3.97',
            },
            geo: { latitude: 35.65, longitude: 139.73 },
            servesCuisine: 'ハンバーガー',
          })}</script>`,
          { headers: { 'content-type': 'text/html' } },
        );
      }
      if (turns++ === 0)
        return Response.json({
          choices: [{ message: { tool_calls: [tool] } }],
        });
      const replies = JSON.parse(init.body).messages;
      assert.ok(
        replies.some((m) =>
          /aggregate restaurant rating: 3.97/u.test(m.content ?? ''),
        ),
      );
      return Response.json({
        choices: [{ message: { content: JSON.stringify(observed) } }],
      });
    },
  });
  const result = await agent.research(input);
  assert.equal(result.value.tabelog.score, 3.97);
  assert.equal(result.value.profile.name.value, 'アルデバラン');
  assert.deepEqual(result.value.profile.coordinates.value, {
    latitude: 35.65,
    longitude: 139.73,
  });
  assert.deepEqual(result.value.profile.categories.value, ['ハンバーガー']);
  assert.equal(reads, 1);
});

test('a branch-matched unrated listing retains its profile and leaves Tabelog score unknown', async () => {
  const agent = createPlaceResearchAgent({
    ...config,
    readSourcePages: true,
    sourceReader: async (target) => {
      assert.equal(target, url);
      return {
        kind: 'read',
        evidence: {
          url,
          title: 'アルデバラン',
          content: 'アルデバラン 東京都港区麻布十番 ハンバーガー',
          restaurant: {
            name: 'アルデバラン',
            address: '東京都港区麻布十番',
            area: '港区麻布十番',
            categories: ['ハンバーガー'],
          },
        },
      };
    },
    fetch: async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                subjectMatch: 'matched',
                tabelog: { status: 'unknown' },
                reservation: { status: 'unknown' },
              }),
            },
          },
        ],
      }),
  });
  const result = await agent.research({
    ...input,
    selectedSubject: { ...subject, providerNamespace: 'tabelog', placeId: url },
  });
  assert.equal(result.kind, 'observed');
  assert.equal(result.value.tabelog.status, 'unknown');
  assert.equal(result.value.profile.name.value, 'アルデバラン');
  assert.deepEqual(result.value.profile.categories.value, ['ハンバーガー']);
});

test('English Tokyo ward address accepts the exact Japanese listing despite model uncertainty', async () => {
  const tenhoUrl = 'https://tabelog.com/tokyo/A1319/A131903/13277105/';
  const selectedSubject = {
    ownerQuery: 'メンドコロ天鳳',
    providerNamespace: 'google-places',
    placeId: 'google-tenho',
    transientName: 'メンドコロ天鳳',
    transientAddress:
      'Japan, 〒164-0011 Tokyo, Nakano City, Chūō, 2-chōme−30−５ ハイムタカラ',
  };
  for (const [sourceAddress, expectedKnown] of [
    ['東京都中野区中央2-30-5 ハイムタカラ 1F', true],
    ['東京都新宿区中央2-30-5 ハイムタカラ 1F', false],
    ['東京都中野区中央2-30-6 ハイムタカラ 1F', false],
  ]) {
    const agent = createPlaceResearchAgent({
      ...config,
      readSourcePages: true,
      sourceReader: async () => ({
        kind: 'read',
        evidence: {
          url: tenhoUrl,
          title: 'メンドコロ 天鳳',
          content: `メンドコロ 天鳳 ${sourceAddress}\nTabelog aggregate restaurant rating: 3.53`,
          restaurant: {
            name: 'メンドコロ 天鳳',
            address: sourceAddress,
            area: '中野区中央',
            score: 3.53,
            categories: ['ラーメン', '汁なし担々麺'],
            coordinates: { latitude: 35.6979, longitude: 139.6792 },
            reservation: '予約不可',
          },
        },
      }),
      fetch: async (endpoint) =>
        endpoint === 'https://api.tavily.com/search'
          ? Response.json({
              results: [{ url: tenhoUrl, content: 'メンドコロ 天鳳' }],
            })
          : Response.json({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      subjectMatch: 'uncertain',
                      tabelog: { status: 'unknown' },
                      reservation: { status: 'unknown' },
                    }),
                  },
                },
              ],
            }),
    });
    const result = await agent.research({ ...input, selectedSubject });
    assert.equal(result.kind, 'observed');
    assert.equal(
      result.value.tabelog.status,
      expectedKnown ? 'known' : 'unknown',
      sourceAddress,
    );
    if (expectedKnown) {
      assert.equal(result.value.tabelog.score, 3.53);
      assert.equal(result.value.profile.address.value, sourceAddress);
      assert.equal(result.value.reservation.mode, 'not_reservable');
    } else {
      assert.equal(result.value.profile, undefined);
    }
  }
});

test('selected-name lookup precedes the model and keeps relocated branches separate', async () => {
  const dataset = JSON.parse(
    readFileSync(
      new URL(
        '../../../benchmarks/place-enrichment/selected-place-regressions.v1.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const listingUrl = dataset.independentSourceCapture.sourceUrl;
  for (const entry of dataset.cases) {
    const wrongBranch = !entry.expectedKnown;
    const calls = [];
    const agent = createPlaceResearchAgent({
      ...config,
      readSourcePages: true,
      sourceReader: async (target) => {
        calls.push('listing');
        assert.equal(target, listingUrl);
        return {
          kind: 'read',
          evidence: {
            url: listingUrl,
            title: 'TONKATSU KEITA',
            content:
              'Synthetic test evidence: 「六白黒豚」のとんかつやシャトーブリアンのヒレカツ。',
            restaurant: {
              name: 'TONKATSU KEITA',
              address: entry.sourceAddress,
              area: '杉並区松庵',
              score: 3.7,
              categories: ['とんかつ'],
              coordinates: { latitude: 35.7, longitude: 139.59 },
              reservation: '完全予約制',
            },
          },
        };
      },
      fetch: async (endpoint, init) => {
        if (endpoint === 'https://api.tavily.com/search') {
          calls.push('search');
          assert.match(
            JSON.parse(init.body).query,
            calls.filter((call) => call === 'search').length === 1
              ? /^TONKATSU KEITA .*3-41-1 site:tabelog\.com$/u
              : /^TONKATSU KEITA .*reservation 公式 予約$/u,
          );
          return Response.json({
            results: [{ url: listingUrl, content: 'Restaurant listing' }],
          });
        }
        calls.push('model');
        assert.equal(
          JSON.parse(JSON.parse(init.body).messages[2].content)
            .remainingSearchCalls,
          1,
        );
        return Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  subjectMatch: 'matched',
                  tabelog: { status: 'unknown' },
                  reservation: { status: 'unknown' },
                  profile: {
                    signatureDishes: [
                      '六白黒豚のとんかつ',
                      'シャトーブリアンのヒレカツ',
                      'invented curry',
                    ],
                  },
                  evidence: {
                    signatureDishes: {
                      url: listingUrl,
                      quote:
                        '「六白黒豚」のとんかつやシャトーブリアンのヒレカツ。',
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
      ...input,
      selectedSubject: {
        ...dataset.selectedSubject,
        ownerQuery: entry.ownerQuery,
      },
    });
    assert.deepEqual(
      calls,
      wrongBranch
        ? ['search', 'listing', 'model']
        : ['search', 'listing', 'search', 'model'],
    );
    assert.equal(result.kind, 'observed');
    assert.equal(
      result.value.tabelog.status,
      wrongBranch ? 'unknown' : 'known',
      entry.caseId,
    );
    if (!wrongBranch) {
      assert.equal(
        result.value.profile.address.value,
        '東京都杉並区松庵3-41-1 西荻高架下',
      );
      assert.equal(result.value.reservation.mode, 'reservation_required');
      assert.deepEqual(result.value.profile.signatureDishes.value, [
        '六白黒豚のとんかつ',
        'シャトーブリアンのヒレカツ',
      ]);
      assert.match(
        result.value.profile.summary.value,
        /招牌菜包括六白黒豚のとんかつ/,
      );
      assert.doesNotMatch(result.value.profile.summary.value, /invented curry/);
    } else {
      assert.equal(result.value.profile?.signatureDishes, undefined);
    }
  }
});

test('selected chain research ranks branch evidence, recovers failed reads and rejects other branches', async () => {
  const dataset = JSON.parse(
    readFileSync(
      new URL(
        '../../../benchmarks/place-enrichment/selected-chain-regressions.v1.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const capture = dataset.sourceCapture;
  const wrongUrl = 'https://tabelog.com/tokyo/A1304/A130401/13143147/';
  for (const entry of dataset.cases) {
    const reads = [];
    const correctAddress = entry.sourceAddress ?? capture.address;
    const agent = createPlaceResearchAgent({
      ...config,
      readSourcePages: true,
      sourceReader: async (target) => {
        reads.push(target);
        if (target === wrongUrl && entry.firstRead === 'unavailable')
          return { kind: 'unavailable' };
        return {
          kind: 'read',
          evidence: {
            url: target,
            title: capture.name,
            content: 'Controlled parsed listing evidence.',
            restaurant: {
              ...capture,
              address:
                target === wrongUrl
                  ? '東京都新宿区新宿3-34-11'
                  : correctAddress,
            },
          },
        };
      },
      fetch: async (endpoint) => {
        if (endpoint === 'https://api.tavily.com/search')
          return Response.json({
            results: [
              {
                url: wrongUrl,
                title: 'Other branch',
                content: 'Uncorroborated first result',
              },
              {
                url: entry.localizedUrl
                  ? capture.url.replace('/tokyo/', '/en/tokyo/')
                  : capture.url,
                title: capture.name,
                content: entry.rankedSnippet
                  ? `${capture.name} ${correctAddress}`
                  : 'Second result',
              },
            ],
          });
        return Response.json({
          choices: [
            {
              message: {
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
    const result = await agent.research({
      ...input,
      selectedSubject: dataset.selectedSubject,
    });
    assert.equal(result.kind, 'observed', entry.id);
    assert.equal(
      result.value.tabelog.status,
      entry.expectedKnown ? 'known' : 'unknown',
      entry.id,
    );
    assert.ok(reads.length <= 3, entry.id);
    if (entry.rankedSnippet) assert.deepEqual(reads, [capture.url], entry.id);
    else assert.deepEqual(reads, [wrongUrl, capture.url], entry.id);
    if (entry.expectedKnown) {
      assert.equal(result.value.tabelog.score, capture.score);
      assert.equal(result.value.profile.address.value, capture.address);
      assert.equal(result.value.reservation.mode, 'reservable');
    } else assert.equal(result.value.profile?.coordinates, undefined);
  }
});

test('failed search can recover within budget but all-failed searches cannot accept a model claim', async () => {
  for (const recover of [true, false]) {
    let searches = 0;
    let turns = 0;
    const agent = createPlaceResearchAgent({
      ...config,
      fetch: async (endpoint) => {
        if (endpoint === 'https://api.tavily.com/search') {
          searches++;
          return recover && searches === 2
            ? Response.json({ results: [{ url, content }] })
            : new Response('', { status: 503 });
        }
        turns++;
        return Response.json({
          choices: [
            {
              message:
                turns < 3
                  ? { tool_calls: [{ ...tool, id: `search${turns}` }] }
                  : { content: JSON.stringify(proposal) },
            },
          ],
        });
      },
    });
    const result = await agent.research(input);
    if (recover) assert.equal(result.value.tabelog.score, 3.97);
    else assert.deepEqual(result, { kind: 'unavailable' });
    assert.equal(searches, 2);
    assert.equal(turns, 3);
  }
});

test('missing model configuration is explicit unavailable; empty config is disabled', async () => {
  assert.equal(createConfiguredPlaceResearchAgent({}), undefined);
  for (const options of [
    { agentApiKey: 'key' },
    {
      agentApiKey: 'key',
      agentBaseUrl: 'https://model.example/v1',
    },
  ]) {
    const port = createConfiguredPlaceResearchAgent(options);
    assert.deepEqual(await port.research(input), { kind: 'unavailable' });
  }
});

test('three model settings enable keyless search and challenge remains unavailable', async () => {
  const endpoints = [];
  let turn = 0;
  const make = (blocked = false) =>
    createConfiguredPlaceResearchAgent({
      agentApiKey: config.apiKey,
      agentBaseUrl: config.baseUrl,
      agentModel: config.model,
      fetch: async (endpoint) => {
        endpoints.push(endpoint);
        if (endpoint.startsWith('https://tabelog.com/'))
          return new Response('', { status: 403 });
        if (endpoint.startsWith('https://search.yahoo.co.jp/search'))
          return blocked
            ? new Response('', { status: 202 })
            : new Response(
                `<div id="web"><ol><li><a href="${url}">アルデバラン</a><div>${content}</div></li></ol></div>`,
              );
        return Response.json({
          choices: [
            {
              message:
                turn++ === 0
                  ? { tool_calls: [tool], content: null }
                  : { content: JSON.stringify(proposal) },
            },
          ],
        });
      },
    });
  assert.equal((await make().research(input)).value.tabelog.score, 3.97);
  assert.equal(
    endpoints.some((endpoint) => endpoint.includes('tavily')),
    false,
  );
  turn = 0;
  assert.deepEqual(await make(true).research(input), { kind: 'unavailable' });
});

test('unsupported optional fields remain unknown rather than failing the whole preview', async () => {
  const final = {
    subjectMatch: 'matched',
    tabelog: { status: 'unknown' },
    reservation: { status: 'unknown' },
    evidence: {},
  };
  assert.deepEqual((await harness(final).agent.research(input)).value, {
    tabelog: { status: 'unknown' },
    reservation: { status: 'unknown' },
  });
});

test('model self-reported match cannot authorize another branch or numeric substring', async () => {
  const wrongBranch = {
    ...input,
    selectedSubject: {
      ...subject,
      transientName: 'Suidobashi Mentsudan',
      transientAddress: 'Tokyo Bunkyo 1-13-2',
    },
  };
  assert.equal(
    (await harness().agent.research(wrongBranch)).value.tabelog.status,
    'unknown',
  );
  const partialScore = structuredClone(proposal);
  partialScore.tabelog.score = 3.9;
  assert.equal(
    (await harness(partialScore).agent.research(input)).value.tabelog.status,
    'unknown',
  );
  const otherSource = structuredClone(proposal);
  otherSource.reservation = {
    status: 'known',
    mode: 'reservable',
    label: 'Reservations accepted',
    url: 'https://other.example/',
  };
  assert.equal(
    (await harness(otherSource).agent.research(input)).value.reservation.status,
    'unknown',
  );
});

test('short selected Japanese names still require matching branch address', async () => {
  const source = 'かぶと 東京都豊島区池袋2-53-2 食べログ 4.42';
  const final = {
    subjectMatch: 'matched',
    tabelog: { status: 'known', score: 4.42, url },
    reservation: { status: 'unknown' },
    evidence: {
      tabelog: {
        url,
        quote: '食べログ 4.42',
        identityQuote: 'かぶと 東京都豊島区池袋2-53-2',
      },
    },
  };
  let turn = 0;
  const agent = createPlaceResearchAgent({
    ...config,
    fetch: async (endpoint) => {
      if (endpoint === 'https://api.tavily.com/search')
        return Response.json({ results: [{ url, content: source }] });
      return Response.json({
        choices: [
          {
            message:
              turn++ % 2 === 0
                ? { tool_calls: [tool] }
                : { content: JSON.stringify(final) },
          },
        ],
      });
    },
  });
  const selectedSubject = {
    ...subject,
    transientName: 'かぶと',
    ownerQuery: 'かぶと',
    transientAddress: 'Tokyo Ikebukuro 2-53-2',
  };
  assert.equal(
    (await agent.research({ ...input, selectedSubject })).value.tabelog.score,
    4.42,
  );
  assert.equal(
    (
      await agent.research({
        ...input,
        selectedSubject: {
          ...selectedSubject,
          transientName: 'Kabuto',
        },
      })
    ).value.tabelog.score,
    4.42,
  );
  assert.equal(
    (
      await agent.research({
        ...input,
        selectedSubject: {
          ...selectedSubject,
          transientAddress: 'Tokyo Ikebukuro 2-53-3',
        },
      })
    ).value.tabelog.status,
    'unknown',
  );
});

test('malformed model endpoint leaves research unavailable without breaking composition', async () => {
  const port = createConfiguredPlaceResearchAgent({
    agentApiKey: 'key',
    agentBaseUrl: 'not a URL',
    agentModel: 'model',
    searchApiKey: 'key',
  });
  assert.deepEqual(await port.research(input), { kind: 'unavailable' });
});

test('Japanese branch evidence can match English Google address by alias and street numbers', async () => {
  const name = '東京麺通団';
  const text =
    '東京麺通団 東京都新宿区西新宿7丁目9番15号 食べログ 3.57 予約可 公式';
  const official = 'https://restaurant.example/reservations';
  const final = {
    subjectMatch: 'matched',
    tabelog: { status: 'known', score: 3.57, url },
    reservation: {
      status: 'known',
      mode: 'reservable',
      label: '予約可',
      url: official,
    },
    evidence: {
      tabelog: {
        url,
        quote: '食べログ 3.57',
        identityQuote: '東京麺通団 東京都新宿区西新宿7丁目9番15号',
      },
      reservation: {
        url: official,
        quote: '予約可 公式',
        identityQuote: '東京麺通団 東京都新宿区西新宿7丁目9番15号',
      },
    },
  };
  let turn = 0;
  const agent = createPlaceResearchAgent({
    ...config,
    fetch: async (endpoint) => {
      if (endpoint === 'https://api.tavily.com/search')
        return Response.json({
          results: [url, official].map((source) => ({
            url: source,
            content: text,
          })),
        });
      return Response.json({
        choices: [
          {
            message:
              turn++ % 2 === 0
                ? { tool_calls: [tool] }
                : { content: JSON.stringify(final) },
          },
        ],
      });
    },
  });
  const multilingual = {
    ...input,
    selectedSubject: {
      ...subject,
      ownerQuery: `讃岐うどん大使 ${name} 新宿`,
      transientName: 'Tōkyō Mentsūdan',
      transientAddress:
        'Japan, 〒160-0023 Tokyo, Shinjuku City, Nishishinjuku, 7-chōme−9−１５',
    },
  };
  const result = await agent.research(multilingual);
  assert.equal(result.value.tabelog.score, 3.57);
  assert.equal(result.value.reservation.status, 'known');
  const wrong = await agent.research({
    ...multilingual,
    selectedSubject: {
      ...multilingual.selectedSubject,
      transientAddress: '1-chōme-13-2 Hongō, Bunkyo City, Tokyo',
    },
  });
  assert.equal(wrong.value.tabelog.status, 'unknown');
  const sameNumbersDifferentCity = await agent.research({
    ...multilingual,
    selectedSubject: {
      ...multilingual.selectedSubject,
      transientAddress: '7-chōme-9-15 Hongō, Bunkyo City, Tokyo',
    },
  });
  assert.equal(sameNumbersDifferentCity.value.tabelog.status, 'unknown');
});

test('booking timing comes from the branch-matched source, not a model number', async () => {
  for (const [sourceAddress, expectedKnown] of [
    ['東京都港区麻布十番', true],
    ['東京都新宿区西新宿', false],
  ]) {
    const agent = createPlaceResearchAgent({
      ...config,
      readSourcePages: true,
      sourceReader: async () => ({
        kind: 'read',
        evidence: {
          url,
          title: 'アルデバラン',
          content: `アルデバラン ${sourceAddress}`,
          restaurant: {
            name: 'アルデバラン',
            address: sourceAddress,
            area: '麻布十番',
            categories: ['ハンバーガー'],
            reservation: '予約可。予約は30日前から受付。',
          },
        },
      }),
      fetch: async (endpoint) =>
        endpoint === 'https://api.tavily.com/search'
          ? Response.json({ results: [{ url, content: 'アルデバラン' }] })
          : Response.json({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      subjectMatch: 'uncertain',
                      tabelog: { status: 'unknown' },
                      reservation: { status: 'unknown' },
                    }),
                  },
                },
              ],
            }),
    });
    const result = await agent.research(input);
    assert.equal(result.kind, 'observed');
    assert.equal(
      result.value.reservation.status,
      expectedKnown ? 'known' : 'unknown',
    );
    if (expectedKnown) {
      assert.equal(result.value.reservation.advanceDays, 30);
      assert.equal(
        result.value.reservation.bookingWindowLabel,
        '30日前から受付',
      );
    }
  }

  const invented = structuredClone(proposal);
  invented.reservation = {
    status: 'known',
    mode: 'reservable',
    label: '予約可',
    advanceDays: 30,
    bookingWindowLabel: '30日前から受付',
    url,
  };
  invented.evidence.reservation = {
    url,
    quote: '予約可です',
    identityQuote: 'アルデバラン 東京都港区麻布十番1-1-1',
  };
  let turn = 0;
  const inventedAgent = createPlaceResearchAgent({
    ...config,
    fetch: async (endpoint) =>
      endpoint === 'https://api.tavily.com/search'
        ? Response.json({
            results: [
              {
                url,
                content: 'アルデバラン 東京都港区麻布十番1-1-1 予約可です',
              },
            ],
          })
        : Response.json({
            choices: [
              {
                message:
                  turn++ === 0
                    ? { tool_calls: [tool] }
                    : { content: JSON.stringify(invented) },
              },
            ],
          }),
  });
  const result = await inventedAgent.research({
    ...input,
    selectedSubject: {
      ...subject,
      transientAddress: '東京都港区麻布十番1-1-1',
    },
  });
  assert.equal(result.value.reservation.status, 'known');
  assert.equal(result.value.reservation.advanceDays, undefined);
  assert.equal(result.value.reservation.bookingWindowLabel, undefined);
});

test('bounded TableCheck read supplies a verified booking window without model invention', async () => {
  const tableUrl =
    'https://www.tablecheck.com/en/koffee-mameya-kakeru/reserve/landing';
  const listingUrl = 'https://tabelog.com/tokyo/A1313/A131303/13255632/';
  const bookingHtml = `<!doctype html><title>KOFFEE MAMEYA -Kakeru- - TableCheck</title>
    <span data-testid="Processed Markup">【Address】</span><br>Hirano 2-16-14, Koto-ku, Tokyo, Japan<br>
    Reservations can be made up to two month in advance.<br>`;
  const selectedSubject = {
    ownerQuery: 'KOFFEE MAMEYA Kakeru Kiyosumi Shirakawa',
    providerNamespace: 'google-places',
    placeId: 'google-kakeru',
    transientName: 'KOFFEE MAMEYA Kakeru',
    transientAddress: '2-chōme-16-14 Hirano, Koto City, Tokyo',
  };
  for (const [page, expectedKnown] of [
    [bookingHtml, true],
    [bookingHtml.replace('Koto-ku', 'Minato-ku'), false],
  ]) {
    let searches = 0;
    let modelTurns = 0;
    const agent = createPlaceResearchAgent({
      ...config,
      readSourcePages: true,
      sourceReader: async () => ({
        kind: 'read',
        evidence: {
          url: listingUrl,
          title: 'KOFFEE MAMEYA Kakeru',
          content: 'KOFFEE MAMEYA Kakeru 東京都江東区平野2-16-14',
          restaurant: {
            name: 'KOFFEE MAMEYA Kakeru',
            address: '東京都江東区平野2-16-14',
            area: '江東区平野',
            categories: ['カフェ'],
            score: 3.51,
          },
        },
      }),
      fetch: async (endpoint) => {
        if (endpoint === tableUrl)
          return new Response(page, {
            headers: { 'content-type': 'text/html' },
          });
        if (endpoint === 'https://api.tavily.com/search')
          return Response.json({
            results:
              searches++ === 0
                ? [{ url: listingUrl, content: 'KOFFEE MAMEYA Kakeru' }]
                : [{ url: tableUrl, content: 'KOFFEE MAMEYA -Kakeru-' }],
          });
        return Response.json({
          choices: [
            {
              message:
                modelTurns++ === 0
                  ? { tool_calls: [tool] }
                  : {
                      content: JSON.stringify({
                        subjectMatch: 'uncertain',
                        tabelog: { status: 'unknown' },
                        reservation: { status: 'unknown' },
                      }),
                    },
            },
          ],
        });
      },
    });
    const result = await agent.research({ ...input, selectedSubject });
    assert.equal(result.kind, 'observed');
    assert.equal(result.value.tabelog.score, 3.51);
    assert.equal(
      result.value.reservation.status,
      expectedKnown ? 'known' : 'unknown',
    );
    if (expectedKnown) {
      assert.equal(
        result.value.reservation.bookingWindowLabel,
        'up to two month in advance',
      );
      assert.equal(result.value.reservation.advanceDays, undefined);
      assert.equal(result.value.reservation.url, tableUrl);
    }
  }
});

test('a branch-matched TableCheck hint directs the second search before the model can miss it', async () => {
  const tableUrl =
    'https://www.tablecheck.com/en/koffee-mameya-kakeru/reserve/landing';
  const listingUrl = 'https://tabelog.com/tokyo/A1313/A131303/13255632/';
  const selectedSubject = {
    ownerQuery: 'KOFFEE MAMEYA Kakeru Kiyosumi Shirakawa',
    providerNamespace: 'google-places',
    placeId: 'google-kakeru',
    transientName: 'KOFFEE MAMEYA Kakeru',
    transientAddress: '2-chōme-16-14 Hirano, Koto City, Tokyo',
  };
  const queries = [];
  let modelCalls = 0;
  const agent = createPlaceResearchAgent({
    ...config,
    readSourcePages: true,
    sourceReader: async () => ({
      kind: 'read',
      evidence: {
        url: listingUrl,
        title: 'KOFFEE MAMEYA Kakeru',
        content: 'KOFFEE MAMEYA Kakeru 東京都江東区平野2-16-14',
        restaurant: {
          name: 'KOFFEE MAMEYA Kakeru',
          address: '東京都江東区平野2-16-14',
          area: '江東区平野',
          categories: ['カフェ'],
          score: 3.51,
          reservation: '完全予約制 予約優先',
          bookingProviderHint: 'tablecheck',
        },
      },
    }),
    fetch: async (endpoint, request) => {
      if (endpoint === tableUrl)
        return new Response(
          '<!doctype html><title>KOFFEE MAMEYA -Kakeru- - TableCheck</title><span>【Address】</span><br>Hirano 2-16-14, Koto-ku, Tokyo, Japan<br>Reservations can be made up to two month in advance.',
          { headers: { 'content-type': 'text/html' } },
        );
      if (endpoint === 'https://api.tavily.com/search') {
        const query = JSON.parse(request.body).query;
        queries.push(query);
        return Response.json({
          results: [
            {
              url: queries.length === 1 ? listingUrl : tableUrl,
              content: 'KOFFEE MAMEYA Kakeru',
            },
          ],
        });
      }
      modelCalls++;
      assert.equal(JSON.parse(request.body).tools, undefined);
      return Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                subjectMatch: 'uncertain',
                tabelog: { status: 'unknown' },
                reservation: { status: 'unknown' },
              }),
            },
          },
        ],
      });
    },
  });
  const result = await agent.research({ ...input, selectedSubject });
  assert.equal(queries.length, 2);
  assert.match(queries[1], /TableCheck site:tablecheck\.com/u);
  assert.equal(modelCalls, 1);
  assert.equal(result.kind, 'observed');
  assert.equal(result.value.reservation.mode, 'reservation_required');
  assert.equal(result.value.reservation.label, '完全予約制 予約優先');
  assert.equal(
    result.value.reservation.bookingWindowLabel,
    'up to two month in advance',
  );
});
