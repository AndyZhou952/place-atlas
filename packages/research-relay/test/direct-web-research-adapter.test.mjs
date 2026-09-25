import assert from "node:assert/strict";
import test from "node:test";

import { createTabelogResearchSourcePolicy } from "../../../apps/web/adapters/research-relay/research-source-policy.ts";
import { createDirectWebResearchAdapters } from "../src/direct-web-research-adapter.ts";

const detailUrl = "https://tabelog.com/tokyo/A1307/A130702/13278678/";
const englishDetailUrl = "https://tabelog.com/en/tokyo/A1307/A130702/13278678/";
const traditionalChineseDetailUrl = "https://tabelog.com/tw/tokyo/A1307/A130702/13278678/";
const secondDetailUrl = "https://tabelog.com/tokyo/A1307/A130702/13270000/";

test("repository-owned web adapter searches a fixed endpoint and fetches only approved Tabelog details", async () => {
  const calls = [];
  const adapters = createDirectWebResearchAdapters({
    sourcePolicy: createTabelogResearchSourcePolicy(),
    dns: {
      async resolve(hostname) {
        return hostname === "search.yahoo.co.jp"
          ? dnsAnswer(["183.79.250.251"])
          : dnsAnswer(["13.112.237.100"]);
      },
    },
    connector: {
      async request(input) {
        calls.push(input);
        if (input.hostHeader === "search.yahoo.co.jp") {
          const result = (url, label) => `<a class="result" href="${url}">${label}</a>`;
          return response(
            input,
            `${result(englishDetailUrl, "Aldebaran English")}
             ${result(traditionalChineseDetailUrl, "Aldebaran Traditional Chinese")}
             ${result(detailUrl, "Aldebaran canonical")}
             ${result(secondDetailUrl, "Different restaurant")}
             <a href="https://tabelog.com/en/tokyo/A1307/A130702/13278678/dtlrvwlst/">reviews</a>
             <a href="https://example.com/private">bad host</a>`,
          );
        }
        return response(
          input,
          `<html><head>
             <title>Aldebaran - Tabelog 3.94</title>
             <meta name="description" content="Reservation via Instagram">
             <script type="application/ld+json">{"aggregateRating":{"ratingValue":"3.94"}}</script>
             <script>ignore ${"x".repeat(70_000)}</script>
           </head><body><h1>Aldebaran</h1>${"menu ".repeat(20_000)}</body></html>`,
        );
      },
    },
  });

  const search = await adapters.searchTool.search({
    query: "Aldebaran Azabujuban",
    maxResults: 3,
    signal: new AbortController().signal,
    deadlineAtMs: Date.now() + 5_000,
  });
  assert.deepEqual(search, { urls: [detailUrl, secondDetailUrl] });
  assert.equal(calls[0].hostHeader, "search.yahoo.co.jp");
  assert.match(calls[0].url, /^https:\/\/search\.yahoo\.co\.jp\/search\?p=/u);
  assert.match(decodeURIComponent(calls[0].url), /site:tabelog\.com/u);

  const fetched = await adapters.transport.get(detailUrl, {
    timeoutMs: 3_000,
    maxRedirects: 0,
    deadlineAtMs: Date.now() + 5_000,
  });
  assert.equal(fetched.status, "ok");
  assert.equal(fetched.finalUrl, detailUrl);
  assert.equal(fetched.requestCount, 1);
  assert.equal(fetched.redirectsFollowed, 0);
  assert.ok(new TextEncoder().encode(fetched.body).byteLength <= 60 * 1024);
  assert.match(fetched.body, /Aldebaran - Tabelog 3\.94/u);
  assert.match(fetched.body, /Reservation via Instagram/u);
  assert.match(fetched.body, /aggregateRating/u);
  assert.doesNotMatch(fetched.body, /ignore x{100}/u);
  assert.doesNotMatch(fetched.body, /<script/u);
  assert.equal(calls[1].hostHeader, "tabelog.com");
  assert.equal(calls[1].followRedirects, false);
  assert.equal(calls[1].retry, false);
});

test("repository-owned search fails closed for invalid input or unsafe DNS", async () => {
  const adapters = createDirectWebResearchAdapters({
    sourcePolicy: createTabelogResearchSourcePolicy(),
    dns: {
      async resolve() {
        return dnsAnswer(["127.0.0.1"]);
      },
    },
    connector: {
      async request() {
        throw new Error("connector must not be reached");
      },
    },
  });
  await assert.rejects(
    adapters.searchTool.search({
      query: "Aldebaran Azabujuban",
      maxResults: 3,
      signal: new AbortController().signal,
      deadlineAtMs: Date.now() + 5_000,
    }),
    /unavailable/u,
  );
  await assert.rejects(
    adapters.searchTool.search({
      query: " Aldebaran ",
      maxResults: 3,
      signal: new AbortController().signal,
      deadlineAtMs: Date.now() + 5_000,
    }),
    /request is invalid/u,
  );
});

function dnsAnswer(addresses) {
  return {
    a: { status: "ok", addresses },
    aaaa: { status: "nodata" },
  };
}

function response(input, body) {
  return {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
    connectedIp: input.pinnedIp,
    body: bodyOf(body),
  };
}

async function* bodyOf(value) {
  yield new TextEncoder().encode(value);
}
