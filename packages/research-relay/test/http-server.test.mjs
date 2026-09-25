import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createResearchRelayServer } from "../src/server.ts";

const bearerSecret = "i".repeat(32);

test("HTTP server rejects unauthorized bodies before reading and survives an aborted request", async (context) => {
  const fixture = await createFixture(context);
  fixture.relay.server.listen(0, fixture.relay.host);
  await new Promise((resolve) => fixture.relay.server.once("listening", resolve));
  const address = fixture.relay.server.address();
  assert.ok(address && typeof address === "object");

  const early = await sendRequest(address.port, {
    headers: {
      authorization: "Bearer wrong",
      "content-length": String(1024 * 1024),
      "content-type": "application/json",
    },
    sendBody: false,
  });
  assert.equal(early.statusCode, 401);
  assert.equal(early.headers.connection, "close");

  await new Promise((resolve) => {
    const request = httpRequest({
      host: fixture.relay.host,
      port: address.port,
      method: "POST",
      path: "/v1/research",
      headers: {
        authorization: `Bearer ${bearerSecret}`,
        "content-length": "100",
        "content-type": "application/json",
      },
    });
    request.on("error", () => resolve());
    request.flushHeaders();
    request.write("{");
    request.destroy();
    setTimeout(resolve, 25);
  });

  const afterAbort = await sendRequest(address.port, {
    headers: {
      authorization: `Bearer ${bearerSecret}`,
      "content-type": "application/json",
    },
    body: "{}",
  });
  assert.equal(afterAbort.statusCode, 400);
  assert.equal(fixture.relay.server.headersTimeout, 5_000);
  assert.equal(fixture.relay.server.requestTimeout, 15_000);
  assert.equal(fixture.relay.server.keepAliveTimeout, 5_000);
  assert.equal(fixture.relay.server.maxHeadersCount, 32);
});

test("HTTP server stops reading an oversized chunked body and remains available", async (context) => {
  const fixture = await createFixture(context);
  fixture.relay.server.listen(0, fixture.relay.host);
  await new Promise((resolve) => fixture.relay.server.once("listening", resolve));
  const address = fixture.relay.server.address();
  assert.ok(address && typeof address === "object");
  const oversized = await sendRequest(address.port, {
    headers: {
      authorization: `Bearer ${bearerSecret}`,
      "content-type": "application/json",
    },
    body: "x".repeat(33 * 1024),
  });
  assert.equal(oversized.statusCode, 400);
  assert.equal(oversized.headers.connection, "close");

  const next = await sendRequest(address.port, {
    headers: { authorization: "Bearer wrong", "content-type": "application/json" },
    body: "{}",
  });
  assert.equal(next.statusCode, 401);
});

test("server cleanup is idempotent before listen and after a bind failure", async (context) => {
  const fixture = await createFixture(context);
  await fixture.relay.close();
  await fixture.relay.close();
  await assert.rejects(fixture.relay.listen(), /cannot be restarted/u);

  const blocker = createNetServer();
  blocker.listen(0, "127.0.0.1");
  await new Promise((resolve) => blocker.once("listening", resolve));
  const address = blocker.address();
  assert.ok(address && typeof address === "object");
  context.after(() => new Promise((resolve) => blocker.close(resolve)));

  const failedFixture = await createFixture(context, address.port);
  await assert.rejects(failedFixture.relay.listen(), (error) => error.code === "EADDRINUSE");
  await failedFixture.relay.close();
  await failedFixture.relay.close();
  await assert.rejects(failedFixture.relay.listen(), /cannot be restarted/u);

  const racePort = await unusedPort();
  const raceFixture = await createFixture(context, racePort);
  const starting = raceFixture.relay.listen();
  const stopping = raceFixture.relay.close();
  await starting;
  await stopping;
  await assert.rejects(raceFixture.relay.listen(), /cannot be restarted/u);
});

async function createFixture(context, port = 18_791) {
  const directory = await mkdtemp(join(tmpdir(), "japan-atlas-relay-"));
  const relay = createResearchRelayServer({
    RESEARCH_RELAY_INGRESS_BEARER_SECRET: bearerSecret,
    RESEARCH_ALLOWANCE_KEY_VERSION: "allowance-v1",
    RESEARCH_ALLOWANCE_HMAC_SECRET: "a".repeat(32),
    RESEARCH_RESULT_KEY_VERSION: "result-v1",
    RESEARCH_RESULT_HMAC_SECRET: "r".repeat(32),
    DEEPSEEK_API_KEY: "d".repeat(32),
    OPENCLAW_GATEWAY_TOKEN: "o".repeat(32),
    RESEARCH_RELAY_SQLITE_PATH: join(directory, "relay.sqlite"),
    RESEARCH_RELAY_PORT: String(port),
  });
  context.after(async () => {
    await relay.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { relay };
}

function sendRequest(port, input) {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "127.0.0.1",
        port,
        method: "POST",
        path: "/v1/research",
        headers: input.headers,
      },
      (response) => {
        response.resume();
        response.once("end", () =>
          resolve({ statusCode: response.statusCode, headers: response.headers }),
        );
      },
    );
    request.once("error", reject);
    if (input.sendBody === false) request.flushHeaders();
    else request.end(input.body ?? "");
  });
}

async function unusedPort() {
  const server = createNetServer();
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}
