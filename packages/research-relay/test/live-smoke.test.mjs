import assert from "node:assert/strict";
import test from "node:test";

import {
  signResearchResult,
  verifyResearchAllowance,
} from "../../../apps/web/adapters/research-relay/research-relay-envelope.ts";
import { runResearchRelayLiveSmoke } from "../src/live-smoke.ts";

test("live smoke verifies the Relay signature and emits only bounded outcome and usage", async () => {
  const now = new Date("2026-09-25T10:00:00.000Z");
  const allowanceSecret = "a".repeat(32);
  const resultSecret = "r".repeat(32);
  const environment = {
    RESEARCH_RELAY_INGRESS_BEARER_SECRET: "i".repeat(32),
    RESEARCH_ALLOWANCE_KEY_VERSION: "allowance-v1",
    RESEARCH_ALLOWANCE_HMAC_SECRET: allowanceSecret,
    RESEARCH_RESULT_KEY_VERSION: "result-v1",
    RESEARCH_RESULT_HMAC_SECRET: resultSecret,
    RESEARCH_RELAY_PORT: "19876",
    RESEARCH_SMOKE_QUERY: "Aldebaran Azabujuban",
    RESEARCH_SMOKE_GOOGLE_PLACE_ID: "google-place-aldebaran",
    RESEARCH_SMOKE_NAME: "Aldebaran",
    RESEARCH_SMOKE_ADDRESS: "Azabujuban, Tokyo",
  };
  const result = await runResearchRelayLiveSmoke(environment, {
    now: () => now,
    requestId: () => "smoke-request",
    async fetch(url, init) {
      assert.equal(url, "http://127.0.0.1:19876/v1/research");
      assert.equal(
        init.headers.Authorization,
        `Bearer ${environment.RESEARCH_RELAY_INGRESS_BEARER_SECRET}`,
      );
      const request = JSON.parse(init.body);
      const verified = await verifyResearchAllowance(request.allowance, {
        keys: { "allowance-v1": allowanceSecret },
        now,
      });
      assert.ok(verified);
      assert.equal(request.payload.subject.placeId, "google-place-aldebaran");
      return Response.json({
        status: "ok",
        result: await signResearchResult({
          requestId: verified.allowance.requestId,
          allowanceDigest: verified.allowanceDigest,
          outcome: {
            kind: "observed",
            proposal: {
              tabelog: { status: "unknown" },
              reservation: { status: "unknown" },
            },
          },
          usage: {
            searchQueries: 1,
            pageRequests: 0,
            elapsedMs: 100,
            maximumRedirectsFollowed: 0,
          },
          expiresAt: verified.allowance.deadline,
          key: { keyVersion: "result-v1", secret: resultSecret },
          now,
        }),
      });
    },
  });
  assert.deepEqual(result, {
    status: "verified",
    outcome: {
      kind: "observed",
      proposal: {
        tabelog: { status: "unknown" },
        reservation: { status: "unknown" },
      },
    },
    usage: {
      searchQueries: 1,
      pageRequests: 0,
      elapsedMs: 100,
      maximumRedirectsFollowed: 0,
    },
  });

  await assert.rejects(
    runResearchRelayLiveSmoke({ ...environment, RESEARCH_RELAY_PORT: "80" }),
    /configuration is invalid/u,
  );
});
