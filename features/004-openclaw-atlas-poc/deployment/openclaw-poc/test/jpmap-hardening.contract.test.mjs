import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { createJpmapPlugin } from "../src/index.mjs";
import { createJpmapRouterClient } from "../src/jpmap-client.mjs";
import { isSupportedNodeVersion, isSupportedOpenClawVersion } from "../src/host-preflight.mjs";

const packageRoot = new URL("../", import.meta.url);
const validEnv = {
  JPMAP_AGENT_ENDPOINT: "https://atlas.example/api/agent/v1/tools",
  JPMAP_AGENT_KEY_ID: "key-1",
  JPMAP_AGENT_HMAC_SECRET: "test-secret",
  JPMAP_OWNER_ACTOR_ID: "owner-actor",
  JPMAP_OWNER_CONVERSATION_ID: "owner-dm",
};
const trustedOwnerContext = {
  args: "nearby 银座",
  senderId: "owner-actor",
  channel: "openclaw-weixin",
  channelId: "openclaw-weixin",
  isAuthorizedSender: true,
  from: "owner-dm",
  to: "owner-dm",
  accountId: "owner-account",
};

test("native command binds the current authorized owner WeChat DM and rejects all other contexts", async () => {
  const registrations = [];
  const requests = [];
  const plugin = createJpmapPlugin({
    client: {
      env: validEnv,
      randomUUID: sequence("mutation-owner", "nonce-owner"),
      nowMs: () => 1_789_300_800_000,
      fetchImpl: async (_url, init) => {
        requests.push(init);
        const request = JSON.parse(init.body);
        return successfulResponse(request.mutationId);
      },
    },
  });
  plugin.register({
    registerCommand(command) {
      registrations.push(command);
    },
  });

  assert.equal(registrations.length, 1);
  assert.equal(typeof registrations[0].handler, "function");
  assert.equal(registrations[0].name, "jpmap");
  assert.deepEqual(registrations[0].channels, ["openclaw-weixin"]);
  assert.equal(registrations[0].requireAuth, true);

  const rejectedContexts = [
    {},
    { ...trustedOwnerContext, isAuthorizedSender: false },
    { ...trustedOwnerContext, senderId: "second-account" },
    { ...trustedOwnerContext, channel: "webchat", channelId: "webchat" },
    { ...trustedOwnerContext, from: "owner-group", to: "owner-group" },
    { ...trustedOwnerContext, messageThreadId: "group-thread" },
    { ...trustedOwnerContext, threadParentId: "parent-thread" },
  ];
  for (const context of rejectedContexts) {
    assert.deepEqual(await registrations[0].handler(context), {
      text: "Japan Atlas 配置不可用，请联系管理员。",
    });
  }
  assert.equal(requests.length, 0);

  const forgedStaticActorClient = createJpmapRouterClient({
    env: validEnv,
    trustedActor: {
      actorId: "owner-actor",
      channel: "openclaw-weixin",
      conversationId: "owner-dm",
      conversationType: "direct",
    },
    fetchImpl: async () => {
      requests.push("forged-static-actor");
      return successfulResponse("unused");
    },
  });
  assert.equal(
    await forgedStaticActorClient(validCommand()),
    "Japan Atlas 配置不可用，请联系管理员。",
  );
  assert.equal(requests.length, 0);

  const result = await registrations[0].handler(trustedOwnerContext);
  assert.equal(result.text, "bounded reply");
  assert.equal(requests.length, 1);
  assert.deepEqual(JSON.parse(requests[0].body).actor, {
    actorId: "owner-actor",
    channel: "openclaw-weixin",
    conversationId: "owner-dm",
    conversationType: "direct",
  });

  const manifest = JSON.parse(await readFile(new URL("openclaw.plugin.json", packageRoot), "utf8"));
  assert.deepEqual(manifest.commandAliases, [{ name: "jpmap", kind: "runtime-slash" }]);
  assert.equal("contracts" in manifest, false);
  assert.equal("toolMetadata" in manifest, false);
});

test("URL-shaped nearby locations are rejected without egress", async () => {
  let egressCount = 0;
  const client = createJpmapRouterClient({
    env: validEnv,
    commandContext: trustedOwnerContext,
    fetchImpl: async () => {
      egressCount += 1;
      return successfulResponse("unused");
    },
  });

  for (const location of [
    "https://maps.google.com/maps?q=ginza",
    "http://example.com/place",
    "maps.app.goo.gl",
    "maps.app.goo.gl/abc123",
    "www.google.com/maps/place/Ginza",
  ]) {
    assert.equal(
      await client({
        command: `nearby ${location}`,
        commandName: "jpmap",
        skillName: "jpmap",
      }),
      "请复制地图中的街区或地址文字，不要发送链接。",
    );
  }
  assert.equal(egressCount, 0);
});

test("response bytes are capped before JSON parsing even when Content-Length is absent or deceptive", async () => {
  const oversizedByHeader = createJpmapRouterClient({
    env: validEnv,
    commandContext: trustedOwnerContext,
    fetchImpl: async () =>
      new Response("{}", {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": "20000",
        },
      }),
  });
  assert.equal(
    await oversizedByHeader(validCommand()),
    "Japan Atlas 附近查询暂时不可用，请稍后重试。",
  );

  for (const headers of [{}, { "content-length": "1" }]) {
    const oversizedStream = createJpmapRouterClient({
      env: validEnv,
      commandContext: trustedOwnerContext,
      fetchImpl: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(10_000));
              controller.enqueue(new Uint8Array(10_000));
              controller.close();
            },
          }),
          { status: 200, headers },
        ),
    });
    assert.equal(
      await oversizedStream(validCommand()),
      "Japan Atlas 附近查询暂时不可用，请稍后重试。",
    );
  }
});

test("host preflight pins the exact OpenClaw 2026.7.1 Node matrix", async () => {
  const packageJson = JSON.parse(await readFile(new URL("package.json", packageRoot), "utf8"));
  assert.equal(packageJson.engines.node, ">=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0");
  for (const version of ["22.22.3", "22.99.0", "24.15.0", "24.99.0", "25.9.0", "26.0.0"]) {
    assert.equal(isSupportedNodeVersion(version), true, version);
  }
  for (const version of ["22.22.2", "23.9.0", "24.14.9", "25.8.9"]) {
    assert.equal(isSupportedNodeVersion(version), false, version);
  }
  assert.equal(isSupportedOpenClawVersion("2026.7.1"), true);
  assert.equal(isSupportedOpenClawVersion("openclaw 2026.7.1"), true);
  assert.equal(
    isSupportedOpenClawVersion("OpenClaw 2026.7.1 (2d2ddc4) — All your chats, one OpenClaw."),
    true,
  );
  assert.equal(isSupportedOpenClawVersion("2026.7.1-beta.6"), false);
  assert.equal(isSupportedOpenClawVersion("2026.7.2"), false);
  assert.equal(isSupportedOpenClawVersion("OpenClaw 2026.7.2 (2d2ddc4) — nope"), false);
  assert.equal(isSupportedOpenClawVersion("OpenClaw\n2026.7.1"), false);
  assert.equal(isSupportedOpenClawVersion("OpenClaw 2026.7.1\n(2d2ddc4)"), false);
  assert.equal(isSupportedOpenClawVersion("OpenClaw 2026.7.1 (2d2ddc4)\n— nope"), false);
});

test("the shipped host preflight runs without the unshipped src directory", async (context) => {
  const stage = await mkdtemp(join(tmpdir(), "jpmap-openclaw-package-"));
  context.after(() => rm(stage, { recursive: true, force: true }));
  await mkdir(join(stage, "scripts"), { recursive: true });
  await mkdir(join(stage, "dist"), { recursive: true });
  await copyFile(
    new URL("../scripts/host-preflight.mjs", import.meta.url),
    join(stage, "scripts", "host-preflight.mjs"),
  );
  await copyFile(
    new URL("../dist/host-preflight.mjs", import.meta.url),
    join(stage, "dist", "host-preflight.mjs"),
  );

  const result = spawnSync(process.execPath, ["scripts/host-preflight.mjs"], {
    cwd: stage,
    encoding: "utf8",
  });

  assert.ok([0, 1].includes(result.status));
  assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND|src\/host-preflight/u);
  const report = JSON.parse(result.stdout);
  assert.equal(typeof report.ok, "boolean");
  assert.deepEqual(Object.keys(report.checks).sort(), ["node", "openclaw", "sqlite"]);
});

function validCommand() {
  return {
    command: "nearby 银座",
    commandName: "jpmap",
    skillName: "jpmap",
  };
}

function successfulResponse(mutationId) {
  return new Response(
    JSON.stringify({
      ok: true,
      receipt: {
        mutationId,
        payloadDigest: "a".repeat(64),
        replayed: false,
        result: {
          projectId: "jpmap",
          operation: "nearby",
          replyText: "bounded reply",
        },
      },
    }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );
}

function sequence(...values) {
  return () => values.shift();
}
