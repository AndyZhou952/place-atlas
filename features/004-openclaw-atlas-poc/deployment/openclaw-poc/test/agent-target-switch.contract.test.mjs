import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { rollbackAgentTarget, switchAgentTarget } from "../scripts/agent-target-switch.mjs";

const oldValues = {
  JPMAP_AGENT_ENDPOINT: "https://old.example/api/agent/v1/tools",
  JPMAP_AGENT_KEY_ID: "old-key-id",
  JPMAP_AGENT_HMAC_SECRET: "old-hmac-secret-with-at-least-32-bytes",
  JPMAP_OWNER_ACTOR_ID: "owner-actor",
  JPMAP_OWNER_CONVERSATION_ID: "owner-direct-message",
};

const nextValues = {
  endpoint: "https://green.example/api/agent/v1/tools",
  keyId: "green-key-id",
  hmac: "green-hmac-secret-with-at-least-32-bytes",
};

test("switch atomically changes only the Agent target and creates a protected rollback snapshot", async (context) => {
  const fixture = await createFixture(context);
  const beforeStat = await stat(fixture.environment);

  const result = await run("switch", fixture);

  assert.equal(result.ok, true, result.error?.code);
  const report = result.report;
  assert.deepEqual(report.names, Object.keys(oldValues));
  assert.equal(report.status, "switched");
  assert.match(report.configurationDigest, /^[0-9a-f]{64}$/u);
  assert.match(report.rollbackDigest, /^[0-9a-f]{64}$/u);
  for (const secret of [...Object.values(oldValues), ...Object.values(nextValues)]) {
    assert.doesNotMatch(JSON.stringify(report), new RegExp(escapeRegExp(secret), "u"));
  }

  assert.deepEqual(await readEnvironment(fixture.environment), {
    JPMAP_AGENT_ENDPOINT: nextValues.endpoint,
    JPMAP_AGENT_KEY_ID: nextValues.keyId,
    JPMAP_AGENT_HMAC_SECRET: nextValues.hmac,
    JPMAP_OWNER_ACTOR_ID: oldValues.JPMAP_OWNER_ACTOR_ID,
    JPMAP_OWNER_CONVERSATION_ID: oldValues.JPMAP_OWNER_CONVERSATION_ID,
  });
  assert.deepEqual(await readEnvironment(fixture.backup), oldValues);

  const afterStat = await stat(fixture.environment);
  const backupStat = await stat(fixture.backup);
  assert.equal(afterStat.mode & 0o777, 0o600);
  assert.equal(backupStat.mode & 0o777, 0o600);
  assert.equal(afterStat.uid, beforeStat.uid);
  assert.equal(afterStat.gid, beforeStat.gid);
  assert.equal(backupStat.uid, beforeStat.uid);
  assert.equal(backupStat.gid, beforeStat.gid);
});

test("rollback restores the protected snapshot without consuming or rewriting it", async (context) => {
  const fixture = await createFixture(context);
  assert.equal((await run("switch", fixture)).ok, true);
  const backupBefore = await readFile(fixture.backup);

  const result = await run("rollback", fixture);

  assert.equal(result.ok, true, result.error?.code);
  assert.equal(result.report.status, "rolled_back");
  assert.deepEqual(await readEnvironment(fixture.environment), oldValues);
  assert.deepEqual(await readFile(fixture.backup), backupBefore);
  for (const secret of [...Object.values(oldValues), ...Object.values(nextValues)]) {
    assert.doesNotMatch(JSON.stringify(result.report), new RegExp(escapeRegExp(secret), "u"));
  }
});

test("post-rename directory sync failure reports a committed switch that needs durability verification", async (context) => {
  const fixture = await createFixture(context);
  let syncCalls = 0;
  const result = await run("switch", fixture, {
    async syncDirectory() {
      syncCalls += 1;
      if (syncCalls === 2) throw new Error("fixture directory sync failure");
    },
  });

  assert.equal(result.ok, true, result.error?.code);
  assert.equal(result.report.status, "switched_durability_unconfirmed");
  assert.deepEqual(await readEnvironment(fixture.environment), {
    JPMAP_AGENT_ENDPOINT: nextValues.endpoint,
    JPMAP_AGENT_KEY_ID: nextValues.keyId,
    JPMAP_AGENT_HMAC_SECRET: nextValues.hmac,
    JPMAP_OWNER_ACTOR_ID: oldValues.JPMAP_OWNER_ACTOR_ID,
    JPMAP_OWNER_CONVERSATION_ID: oldValues.JPMAP_OWNER_CONVERSATION_ID,
  });
  assert.deepEqual(await readEnvironment(fixture.backup), oldValues);
  for (const secret of [...Object.values(oldValues), ...Object.values(nextValues)]) {
    assert.doesNotMatch(JSON.stringify(result.report), new RegExp(escapeRegExp(secret), "u"));
  }
});

test("post-rename directory sync failure reports a committed rollback that needs durability verification", async (context) => {
  const fixture = await createFixture(context);
  assert.equal((await run("switch", fixture)).ok, true);

  const result = await run("rollback", fixture, {
    async syncDirectory() {
      throw new Error("fixture directory sync failure");
    },
  });

  assert.equal(result.ok, true, result.error?.code);
  assert.equal(result.report.status, "rolled_back_durability_unconfirmed");
  assert.deepEqual(await readEnvironment(fixture.environment), oldValues);
});

test("validation failures leave the environment untouched and create no backup", async (context) => {
  for (const invalidSource of [
    { endpoint: "http://green.example/api/agent/v1/tools" },
    { endpoint: "https://green.example/wrong" },
    { endpoint: "https://user:password@green.example/api/agent/v1/tools" },
    { endpoint: "https://green.example/api/agent/v1/tools?debug=1" },
    { keyId: "key id with spaces" },
    { hmac: "too-short" },
    { hmac: `valid-hmac-secret-with-32-bytes-plus\nsecond-line` },
  ]) {
    const fixture = await createFixture(context, invalidSource);
    const before = await readFile(fixture.environment);

    const result = await run("switch", fixture);

    assert.equal(result.ok, false);
    assert.equal(typeof result.error.code, "string");
    assert.deepEqual(await readFile(fixture.environment), before);
    await assert.rejects(lstat(fixture.backup), { code: "ENOENT" });
    assert.doesNotMatch(JSON.stringify(result.error), /password|debug=1|second-line/u);
  }
});

test("unknown or duplicate JPMAP keys fail closed before any write", async (context) => {
  for (const extraLine of ["JPMAP_UNREVIEWED_SWITCH=enabled", "JPMAP_AGENT_KEY_ID=duplicate-key"]) {
    const fixture = await createFixture(context);
    await writeFile(
      fixture.environment,
      `${await readFile(fixture.environment, "utf8")}${extraLine}\n`,
      { mode: 0o600 },
    );
    const before = await readFile(fixture.environment);

    const result = await run("switch", fixture);

    assert.equal(result.ok, false);
    assert.deepEqual(await readFile(fixture.environment), before);
    await assert.rejects(lstat(fixture.backup), { code: "ENOENT" });
  }
});

test("source files must be protected regular files and rollback snapshots cannot be overwritten", async (context) => {
  const permissive = await createFixture(context);
  await chmod(permissive.hmac, 0o640);
  const permissiveBefore = await readFile(permissive.environment);
  assert.equal((await run("switch", permissive)).ok, false);
  assert.deepEqual(await readFile(permissive.environment), permissiveBefore);

  const linked = await createFixture(context);
  const linkedReal = `${linked.keyId}.real`;
  await writeFile(linkedReal, `${nextValues.keyId}\n`, { mode: 0o600 });
  await rm(linked.keyId);
  await symlink(linkedReal, linked.keyId);
  const linkedBefore = await readFile(linked.environment);
  assert.equal((await run("switch", linked)).ok, false);
  assert.deepEqual(await readFile(linked.environment), linkedBefore);

  const protectedBackup = await createFixture(context);
  assert.equal((await run("switch", protectedBackup)).ok, true);
  const switched = await readFile(protectedBackup.environment);
  const backup = await readFile(protectedBackup.backup);
  const second = await run("switch", protectedBackup);
  assert.equal(second.ok, false);
  assert.deepEqual(await readFile(protectedBackup.environment), switched);
  assert.deepEqual(await readFile(protectedBackup.backup), backup);
});

async function createFixture(context, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), "jpmap-agent-target-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = {
    directory,
    environment: join(directory, "openclaw.env"),
    backup: join(directory, "openclaw.env.jpmap-rollback"),
    endpoint: join(directory, "endpoint.secret"),
    keyId: join(directory, "key-id.secret"),
    hmac: join(directory, "hmac.secret"),
  };
  await writeFile(
    fixture.environment,
    `${Object.entries(oldValues)
      .map(([name, value]) => `${name}=${value}`)
      .join("\n")}\n`,
    { mode: 0o600 },
  );
  await writeProtected(fixture.endpoint, `${overrides.endpoint ?? nextValues.endpoint}\n`);
  await writeProtected(fixture.keyId, `${overrides.keyId ?? nextValues.keyId}\n`);
  await writeProtected(fixture.hmac, `${overrides.hmac ?? nextValues.hmac}\n`);
  return fixture;
}

async function run(action, fixture, dependencies) {
  const options = {
    environmentFile: fixture.environment,
    backupFile: fixture.backup,
  };
  if (action === "switch") {
    Object.assign(options, {
      endpointFile: fixture.endpoint,
      keyIdFile: fixture.keyId,
      hmacSecretFile: fixture.hmac,
    });
  }
  try {
    const report =
      action === "switch"
        ? await switchAgentTarget(options, dependencies)
        : await rollbackAgentTarget(options, dependencies);
    return { ok: true, report };
  } catch (error) {
    return { ok: false, error: { code: error.code } };
  }
}

async function readEnvironment(path) {
  return Object.fromEntries(
    (await readFile(path, "utf8"))
      .trim()
      .split("\n")
      .map((line) => line.split("=")),
  );
}

async function writeProtected(path, value) {
  await writeFile(path, value, { mode: 0o600 });
  await chmod(path, 0o600);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
