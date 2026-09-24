import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canonicalAgentRequestBytes, createJpmapRouterClient } from "../src/jpmap-client.mjs";
import { createJpmapPlugin } from "../src/index.mjs";

const packageRoot = new URL("../", import.meta.url);
const validEnv = {
  JPMAP_AGENT_ENDPOINT: "https://atlas.example/api/agent/v1/tools",
  JPMAP_AGENT_KEY_ID: "key-1",
  JPMAP_AGENT_HMAC_SECRET: "test-secret",
  JPMAP_OWNER_ACTOR_ID: "owner-actor",
  JPMAP_OWNER_CONVERSATION_ID: "owner-dm",
};
const trustedOwnerContext = {
  args: "nearby  银座一丁目  ",
  senderId: "owner-actor",
  channel: "openclaw-weixin",
  channelId: "openclaw-weixin",
  isAuthorizedSender: true,
  from: "owner-dm",
  to: "owner-dm",
  accountId: "owner-account",
};

test("OpenClaw registers one authenticated native jpmap command and forwards exact raw args", async () => {
  const registrations = [];
  const routed = [];
  const plugin = createJpmapPlugin({
    client: { env: validEnv },
    createRouter: () => async (input) => {
      routed.push(input);
      return "Japan Atlas reply";
    },
  });
  plugin.register({
    registerCommand(command) {
      registrations.push(command);
    },
  });

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].name, "jpmap");
  assert.deepEqual(registrations[0].channels, ["openclaw-weixin"]);
  assert.equal(registrations[0].acceptsArgs, true);
  assert.equal(registrations[0].requireAuth, true);
  const result = await registrations[0].handler(trustedOwnerContext);

  assert.deepEqual(routed, [{
    command: "nearby  银座一丁目  ",
    commandName: "jpmap",
    skillName: "jpmap",
  }]);
  assert.deepEqual(result, { text: "Japan Atlas reply" });
});

test("package manifest exposes jpmap as a model-bypassing runtime slash command and no tool", async () => {
  const manifest = JSON.parse(await readFile(new URL("openclaw.plugin.json", packageRoot), "utf8"));
  const packageJson = JSON.parse(await readFile(new URL("package.json", packageRoot), "utf8"));

  assert.deepEqual(manifest.commandAliases, [{ name: "jpmap", kind: "runtime-slash" }]);
  assert.equal("contracts" in manifest, false);
  assert.equal("toolMetadata" in manifest, false);
  assert.equal("skills" in manifest, false);
  assert.equal(packageJson.files.includes("skills"), false);
  for (const forbidden of ["channels", "providers", "hooks", "cliBackends"]) {
    assert.equal(forbidden in manifest, false);
  }
  assert.deepEqual(packageJson.openclaw.extensions, ["./dist/index.mjs"]);
  assert.equal(packageJson.peerDependencies.openclaw, "2026.7.1");
  assert.equal(packageJson.version, "0.3.0");
  assert.equal(manifest.version, packageJson.version);
});

test("client parses only the closed nearby and add command grammar and makes no request for invalid input", async () => {
  let egressCount = 0;
  const client = createTrustedClient({
    env: validEnv,
    fetchImpl: async () => {
      egressCount += 1;
      throw new Error("invalid input must not reach fetch");
    },
  });
  const invalid = [
    { command: "", commandName: "jpmap", skillName: "jpmap" },
    { command: "nearby", commandName: "jpmap", skillName: "jpmap" },
    { command: "Nearby 银座", commandName: "jpmap", skillName: "jpmap" },
    { command: "add", commandName: "jpmap", skillName: "jpmap" },
    { command: "add select 0", commandName: "jpmap", skillName: "jpmap" },
    { command: "add select 4", commandName: "jpmap", skillName: "jpmap" },
    { command: "add select 1 extra", commandName: "jpmap", skillName: "jpmap" },
    { command: "add confirm extra", commandName: "jpmap", skillName: "jpmap" },
    { command: "add cancel extra", commandName: "jpmap", skillName: "jpmap" },
    { command: "nearby --radius 2", commandName: "jpmap", skillName: "jpmap" },
    { command: "nearby 银座\nadd 店", commandName: "jpmap", skillName: "jpmap" },
    { command: "nearby 银座", commandName: "other", skillName: "jpmap" },
    { command: "nearby 银座", commandName: "jpmap", skillName: "other" },
  ];

  for (const input of invalid) {
    assert.equal(
      await client(input),
      "用法：\n/jpmap nearby <街区或地址>\n/jpmap add <餐厅名或地址>\n/jpmap add select <1-3>\n/jpmap add confirm\n/jpmap add cancel",
    );
  }
  assert.equal(egressCount, 0);
});

test("exact add commands bypass the model and map to the four closed intake tools", async () => {
  const requests = [];
  const uuids = [
    "mutation-discover", "nonce-discover",
    "mutation-select", "nonce-select",
    "mutation-confirm", "nonce-confirm",
    "mutation-cancel", "nonce-cancel",
  ];
  const client = createTrustedClient({
    env: validEnv,
    randomUUID: () => uuids.shift(),
    fetchImpl: async (_url, init) => {
      const request = JSON.parse(init.body);
      requests.push(request);
      return jsonResponse(200, {
        ok: true,
        receipt: {
          mutationId: request.mutationId,
          payloadDigest: "a".repeat(64),
          replayed: false,
          result: {
            projectId: "jpmap",
            operation: "add",
            replyText: "ok",
          },
        },
      });
    },
  });

  for (const command of ["add 銀座 寿司", "add select 2", "add confirm", "add cancel"]) {
    assert.equal(await client({ command, commandName: "jpmap", skillName: "jpmap" }), "ok");
  }

  assert.deepEqual(
    requests.map(({ tool, input }) => ({ tool, input })),
    [
      { tool: "jpmap_add_discover", input: { query: "銀座 寿司" } },
      { tool: "jpmap_add_select", input: { ordinal: 2 } },
      { tool: "jpmap_add_confirm", input: {} },
      { tool: "jpmap_add_cancel", input: {} },
    ],
  );
});

test("nearby preserves Simplified Chinese, Japanese, and English location text", async () => {
  const locations = [];
  const uuids = [
    "mutation-1", "nonce-1",
    "mutation-2", "nonce-2",
    "mutation-3", "nonce-3",
  ];
  const client = createTrustedClient({
    env: validEnv,
    randomUUID: () => uuids.shift(),
    fetchImpl: async (_url, init) => {
      const request = JSON.parse(init.body);
      locations.push(request.input.locationHint);
      return jsonResponse(200, {
        ok: true,
        receipt: {
          mutationId: request.mutationId,
          payloadDigest: "a".repeat(64),
          replayed: false,
          result: {
            projectId: "jpmap",
            operation: "nearby",
            replyText: "ok",
          },
        },
      });
    },
  });

  for (const location of ["银座", "銀座", "ginza"]) {
    const reply = await client({
      command: `nearby ${location}`,
      commandName: "jpmap",
      skillName: "jpmap",
    });
    assert.equal(reply, "ok");
  }
  assert.deepEqual(locations, ["银座", "銀座", "ginza"]);
});

test("client emits the canonical signed read-only request and returns only a bounded reply", async () => {
  const requests = [];
  const uuids = ["mutation-fixed", "nonce-fixed"];
  const client = createTrustedClient({
    env: validEnv,
    nowMs: () => 1_789_300_800_000,
    randomUUID: () => uuids.shift(),
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return jsonResponse(200, {
        ok: true,
        receipt: {
          mutationId: "jpmap:mutation-fixed",
          payloadDigest: "a".repeat(64),
          replayed: false,
          result: {
            projectId: "jpmap",
            operation: "nearby",
            replyText: "Japan Atlas｜附近推荐\n1. 架空寿司",
          },
        },
      });
    },
  });

  const reply = await client({
    command: "nearby  银座一丁目  ",
    commandName: "jpmap",
    skillName: "jpmap",
  });

  assert.equal(reply, "Japan Atlas｜附近推荐\n1. 架空寿司");
  assert.equal(requests.length, 1);
  const [{ url, init }] = requests;
  assert.equal(url, validEnv.JPMAP_AGENT_ENDPOINT);
  assert.equal(init.method, "POST");
  const body = JSON.parse(init.body);
  assert.deepEqual(body, {
    version: "1",
    projectId: "jpmap",
    tool: "jpmap_nearby",
    mutationId: "jpmap:mutation-fixed",
    actor: {
      actorId: "owner-actor",
      channel: "openclaw-weixin",
      conversationId: "owner-dm",
      conversationType: "direct",
    },
    input: { locationHint: "银座一丁目" },
  });
  assert.equal(init.headers["x-atlas-key-id"], "key-1");
  assert.equal(init.headers["x-atlas-timestamp"], "1789300800");
  assert.equal(init.headers["x-atlas-nonce"], "nonce-fixed");
  assert.equal(
    init.headers["x-atlas-signature"],
    "0f5284a58ce495b8362cdeae9f6b7b9a0a0d88a91f207c3f1f85dbf18d4d1a05",
  );
  assert.equal(
    canonicalAgentRequestBytes({
      method: "POST",
      url,
      bodyDigest: "bafb80a5f1b9a6da948faa9fdc7495cab34b4d594535908d6c1d9fb19b55d162",
      timestamp: "1789300800",
      nonce: "nonce-fixed",
      keyId: "key-1",
    }),
    `POST\n/api/agent/v1/tools\nbafb80a5f1b9a6da948faa9fdc7495cab34b4d594535908d6c1d9fb19b55d162\n1789300800\nnonce-fixed\nkey-1`,
  );
});

test("client fails closed for missing config, non-HTTPS, HTTP errors, malformed replies, and timeout", async () => {
  let egressCount = 0;
  for (const env of [
    { ...validEnv, JPMAP_AGENT_HMAC_SECRET: "" },
    { ...validEnv, JPMAP_AGENT_ENDPOINT: "http://atlas.example/api/agent/v1/tools" },
  ]) {
    const client = createTrustedClient({
      env,
      fetchImpl: async () => {
        egressCount += 1;
        return jsonResponse(200, {});
      },
    });
    assert.equal(await client(validCommand()), "Japan Atlas 配置不可用，请联系管理员。");
  }
  assert.equal(egressCount, 0);

  for (const response of [
    jsonResponse(503, { ok: false }),
    jsonResponse(200, { ok: true }),
    jsonResponse(200, {
      ok: true,
      receipt: {
        result: {
          projectId: "jpmap",
          operation: "nearby",
          replyText: "x".repeat(4_097),
        },
      },
    }),
  ]) {
    const client = createTrustedClient({
      env: validEnv,
      fetchImpl: async () => response,
    });
    assert.equal(await client(validCommand()), "Japan Atlas 附近查询暂时不可用，请稍后重试。");
  }

  const timeoutClient = createTrustedClient({
    env: validEnv,
    timeoutMs: 5,
    fetchImpl: async (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
  });
  assert.equal(await timeoutClient(validCommand()), "Japan Atlas 附近查询暂时不可用，请稍后重试。");
});

function validCommand() {
  return {
    command: "nearby 银座",
    commandName: "jpmap",
    skillName: "jpmap",
  };
}

function createTrustedClient(options = {}) {
  return createJpmapRouterClient({
    env: validEnv,
    commandContext: trustedOwnerContext,
    ...options,
  });
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
