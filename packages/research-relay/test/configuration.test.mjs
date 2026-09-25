import assert from "node:assert/strict";
import test from "node:test";

import { createResearchRelayServer } from "../src/server.ts";

test("server fails closed before binding when any required configuration is missing or unsafe", () => {
  const complete = {
    RESEARCH_RELAY_INGRESS_BEARER_SECRET: "i".repeat(32),
    RESEARCH_ALLOWANCE_KEY_VERSION: "allowance-v1",
    RESEARCH_ALLOWANCE_HMAC_SECRET: "a".repeat(32),
    RESEARCH_RESULT_KEY_VERSION: "result-v1",
    RESEARCH_RESULT_HMAC_SECRET: "r".repeat(32),
    DEEPSEEK_API_KEY: "d".repeat(32),
    OPENCLAW_GATEWAY_TOKEN: "o".repeat(32),
    RESEARCH_RELAY_SQLITE_PATH: "/tmp/japan-atlas-relay-test.sqlite",
  };
  for (const key of Object.keys(complete)) {
    assert.throws(
      () => createResearchRelayServer({ ...complete, [key]: undefined }),
      /configuration is invalid/u,
      key,
    );
  }
  assert.throws(
    () =>
      createResearchRelayServer({
        ...complete,
        OPENCLAW_TOOLS_ENDPOINT: "https://public.example/tools/invoke",
      }),
    /configuration is invalid/u,
  );
});
