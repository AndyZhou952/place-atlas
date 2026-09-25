import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createResearchRelayServer } from "../src/server.ts";

test("server defaults to the repository-owned web provider and fails closed for invalid configuration", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "japan-atlas-config-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const complete = {
    RESEARCH_RELAY_INGRESS_BEARER_SECRET: "i".repeat(32),
    RESEARCH_ALLOWANCE_KEY_VERSION: "allowance-v1",
    RESEARCH_ALLOWANCE_HMAC_SECRET: "a".repeat(32),
    RESEARCH_RESULT_KEY_VERSION: "result-v1",
    RESEARCH_RESULT_HMAC_SECRET: "r".repeat(32),
    DEEPSEEK_API_KEY: "d".repeat(32),
    RESEARCH_RELAY_SQLITE_PATH: join(directory, "relay.sqlite"),
  };
  for (const key of Object.keys(complete)) {
    assert.throws(
      () => createResearchRelayServer({ ...complete, [key]: undefined }),
      /configuration is invalid/u,
      key,
    );
  }
  const direct = createResearchRelayServer(complete);
  await direct.close();

  assert.throws(
    () =>
      createResearchRelayServer({
        ...complete,
        RESEARCH_WEB_PROVIDER: "openclaw_gateway",
        OPENCLAW_GATEWAY_TOKEN: "o".repeat(32),
        OPENCLAW_TOOLS_ENDPOINT: "https://public.example/tools/invoke",
      }),
    /configuration is invalid/u,
  );
  assert.throws(
    () =>
      createResearchRelayServer({
        ...complete,
        RESEARCH_WEB_PROVIDER: "openclaw_gateway",
      }),
    /configuration is invalid/u,
  );
  assert.throws(
    () =>
      createResearchRelayServer({
        ...complete,
        RESEARCH_WEB_PROVIDER: "unknown",
      }),
    /configuration is invalid/u,
  );
});
