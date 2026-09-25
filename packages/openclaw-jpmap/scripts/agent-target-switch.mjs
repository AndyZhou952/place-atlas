#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const requiredNames = Object.freeze([
  "JPMAP_AGENT_ENDPOINT",
  "JPMAP_AGENT_KEY_ID",
  "JPMAP_AGENT_HMAC_SECRET",
  "JPMAP_OWNER_ACTOR_ID",
  "JPMAP_OWNER_CONVERSATION_ID",
]);
const switchedNames = new Set(requiredNames.slice(0, 3));
const maximumEnvironmentBytes = 64 * 1024;
const maximumSecretFileBytes = 4_097;

class SwitchError extends Error {
  constructor(code) {
    super(code);
    this.name = "SwitchError";
    this.code = code;
  }
}

export async function switchAgentTarget(options, dependencies = {}) {
  const synchronizeDirectory = dependencies.syncDirectory ?? syncDirectory;
  const paths = validatePaths(options, true);
  const current = await readProtectedFile(paths.environmentFile, {
    maximumBytes: maximumEnvironmentBytes,
    role: "environment",
  });
  assertServiceAccountAccess(current.stat);
  await assertProtectedDirectory(dirname(paths.environmentFile), current.stat);
  const parsed = parseEnvironment(current.text);
  validateConfiguration(parsed.values);
  await assertPathAbsent(paths.backupFile);

  const [endpointSource, keyIdSource, hmacSource] = await Promise.all([
    readProtectedFile(paths.endpointFile, {
      maximumBytes: maximumSecretFileBytes,
      role: "source",
    }),
    readProtectedFile(paths.keyIdFile, {
      maximumBytes: maximumSecretFileBytes,
      role: "source",
    }),
    readProtectedFile(paths.hmacSecretFile, {
      maximumBytes: maximumSecretFileBytes,
      role: "source",
    }),
  ]);
  const replacements = {
    JPMAP_AGENT_ENDPOINT: readSingleLine(endpointSource.text, "invalid_endpoint_source"),
    JPMAP_AGENT_KEY_ID: readSingleLine(keyIdSource.text, "invalid_key_id_source"),
    JPMAP_AGENT_HMAC_SECRET: readSingleLine(hmacSource.text, "invalid_hmac_source"),
  };
  validateEndpoint(replacements.JPMAP_AGENT_ENDPOINT);
  validateIdentifier(replacements.JPMAP_AGENT_KEY_ID, 128, "invalid_key_id");
  validateHmacSecret(replacements.JPMAP_AGENT_HMAC_SECRET);

  const nextText = renderEnvironment(parsed, replacements);
  const nextValues = parseEnvironment(nextText).values;
  validateConfiguration(nextValues);

  await createProtectedSnapshot(
    paths.backupFile,
    current.bytes,
    current.stat,
    synchronizeDirectory,
  );
  let durabilityConfirmed;
  try {
    durabilityConfirmed = await replaceProtectedFile(
      paths.environmentFile,
      Buffer.from(nextText, "utf8"),
      current.stat,
      synchronizeDirectory,
    );
  } catch (error) {
    // The live environment remains unchanged on every pre-rename failure. The
    // completed rollback snapshot is intentionally retained if rename itself
    // fails, so an operator never loses the known-good target.
    throw normalizeError(error, "environment_replace_failed");
  }

  return createReport(
    durabilityConfirmed ? "switched" : "switched_durability_unconfirmed",
    nextText,
    current.text,
  );
}

export async function rollbackAgentTarget(options, dependencies = {}) {
  const synchronizeDirectory = dependencies.syncDirectory ?? syncDirectory;
  const paths = validatePaths(options, false);
  const [current, backup] = await Promise.all([
    readProtectedFile(paths.environmentFile, {
      maximumBytes: maximumEnvironmentBytes,
      role: "environment",
    }),
    readProtectedFile(paths.backupFile, {
      maximumBytes: maximumEnvironmentBytes,
      role: "backup",
      requireMode0600: true,
    }),
  ]);
  assertServiceAccountAccess(current.stat);
  await assertProtectedDirectory(dirname(paths.environmentFile), current.stat);
  if (current.stat.uid !== backup.stat.uid || current.stat.gid !== backup.stat.gid) {
    throw new SwitchError("backup_ownership_mismatch");
  }
  validateConfiguration(parseEnvironment(current.text).values);
  validateConfiguration(parseEnvironment(backup.text).values);

  const durabilityConfirmed = await replaceProtectedFile(
    paths.environmentFile,
    backup.bytes,
    current.stat,
    synchronizeDirectory,
  );
  return createReport(
    durabilityConfirmed ? "rolled_back" : "rolled_back_durability_unconfirmed",
    backup.text,
    backup.text,
  );
}

function validatePaths(options, switching) {
  const required = switching
    ? ["environmentFile", "backupFile", "endpointFile", "keyIdFile", "hmacSecretFile"]
    : ["environmentFile", "backupFile"];
  for (const name of required) {
    if (typeof options?.[name] !== "string" || !isAbsolute(options[name])) {
      throw new SwitchError("invalid_arguments");
    }
  }
  const normalized = Object.fromEntries(required.map((name) => [name, resolve(options[name])]));
  if (dirname(normalized.environmentFile) !== dirname(normalized.backupFile)) {
    throw new SwitchError("backup_must_share_environment_directory");
  }
  if (new Set(Object.values(normalized)).size !== required.length) {
    throw new SwitchError("path_collision");
  }
  return normalized;
}

async function readProtectedFile(path, options) {
  let before;
  try {
    before = await lstat(path);
  } catch (error) {
    throw normalizeError(error, `${options.role}_unavailable`);
  }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
    throw new SwitchError(`${options.role}_not_regular`);
  }
  if (before.size < 1 || before.size > options.maximumBytes) {
    throw new SwitchError(`${options.role}_size_invalid`);
  }

  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino
    ) {
      throw new SwitchError(`${options.role}_changed_during_read`);
    }
    if ((opened.mode & 0o077) !== 0) {
      throw new SwitchError(`${options.role}_permissions_too_open`);
    }
    if (options.requireMode0600 && (opened.mode & 0o777) !== 0o600) {
      throw new SwitchError(`${options.role}_mode_not_0600`);
    }
    const bytes = await handle.readFile();
    if (bytes.length < 1 || bytes.length > options.maximumBytes) {
      throw new SwitchError(`${options.role}_size_invalid`);
    }
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new SwitchError(`${options.role}_encoding_invalid`);
    }
    return { bytes, stat: opened, text };
  } catch (error) {
    throw normalizeError(error, `${options.role}_unavailable`);
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function parseEnvironment(text) {
  if (text.includes("\0") || text.includes("\r")) {
    throw new SwitchError("environment_format_invalid");
  }
  const lines = text.split("\n");
  const values = {};
  const locations = new Map();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === "" || /^\s*#/u.test(line)) continue;
    const match = /^([A-Z_][A-Z0-9_]*)=(.*)$/u.exec(line);
    if (!match) throw new SwitchError("environment_format_invalid");
    const [, name, value] = match;
    if (!name.startsWith("JPMAP_")) continue;
    if (!requiredNames.includes(name)) throw new SwitchError("unknown_jpmap_key");
    if (locations.has(name)) throw new SwitchError("duplicate_jpmap_key");
    values[name] = value;
    locations.set(name, index);
  }
  if (requiredNames.some((name) => !locations.has(name))) {
    throw new SwitchError("missing_jpmap_key");
  }
  return { lines, locations, values };
}

function validateConfiguration(values) {
  if (Object.keys(values).length !== requiredNames.length) {
    throw new SwitchError("jpmap_key_set_invalid");
  }
  validateEndpoint(values.JPMAP_AGENT_ENDPOINT);
  validateIdentifier(values.JPMAP_AGENT_KEY_ID, 128, "invalid_key_id");
  validateHmacSecret(values.JPMAP_AGENT_HMAC_SECRET);
  validateOwnerValue(values.JPMAP_OWNER_ACTOR_ID, "invalid_owner_actor");
  validateOwnerValue(values.JPMAP_OWNER_CONVERSATION_ID, "invalid_owner_conversation");
}

function validateEndpoint(value) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 2_048 ||
    hasControl(value) ||
    /\s/u.test(value)
  ) {
    throw new SwitchError("invalid_endpoint");
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new SwitchError("invalid_endpoint");
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/api/agent/v1/tools" ||
    (url.port !== "" && url.port !== "443")
  ) {
    throw new SwitchError("invalid_endpoint");
  }
}

function validateIdentifier(value, maximumLength, code) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    !/^[A-Za-z0-9._-]+$/u.test(value)
  ) {
    throw new SwitchError(code);
  }
}

function validateOwnerValue(value, code) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 256 ||
    hasControl(value) ||
    !/^[A-Za-z0-9._:@/+~-]+$/u.test(value)
  ) {
    throw new SwitchError(code);
  }
}

function validateHmacSecret(value) {
  if (
    typeof value !== "string" ||
    value.length < 32 ||
    value.length > 4_096 ||
    hasControl(value) ||
    !/^[A-Za-z0-9._~+/=:-]+$/u.test(value)
  ) {
    throw new SwitchError("invalid_hmac_secret");
  }
}

function readSingleLine(text, code) {
  const value = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (value.includes("\n") || value.includes("\r") || value.length === 0) {
    throw new SwitchError(code);
  }
  return value;
}

function renderEnvironment(parsed, replacements) {
  const lines = [...parsed.lines];
  for (const name of switchedNames) {
    lines[parsed.locations.get(name)] = `${name}=${replacements[name]}`;
  }
  return lines.join("\n");
}

async function assertPathAbsent(path) {
  try {
    await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw normalizeError(error, "backup_unavailable");
  }
  throw new SwitchError("backup_already_exists");
}

async function createProtectedSnapshot(path, bytes, owner, synchronizeDirectory) {
  const temporary = temporaryPath(path);
  let temporaryExists = false;
  try {
    await writePreparedFile(temporary, bytes, owner);
    temporaryExists = true;
    await link(temporary, path);
    await unlink(temporary);
    temporaryExists = false;
    await synchronizeDirectory(dirname(path));
  } catch (error) {
    if (temporaryExists) await unlink(temporary).catch(() => undefined);
    throw normalizeError(
      error,
      error?.code === "EEXIST" ? "backup_already_exists" : "backup_create_failed",
    );
  }
}

async function replaceProtectedFile(path, bytes, owner, synchronizeDirectory) {
  const current = await lstat(path).catch((error) => {
    throw normalizeError(error, "environment_changed_before_replace");
  });
  if (current.dev !== owner.dev || current.ino !== owner.ino || !current.isFile()) {
    throw new SwitchError("environment_changed_before_replace");
  }
  const temporary = temporaryPath(path);
  let temporaryExists = false;
  try {
    await writePreparedFile(temporary, bytes, owner);
    temporaryExists = true;
    const finalCheck = await lstat(path);
    if (finalCheck.dev !== owner.dev || finalCheck.ino !== owner.ino) {
      throw new SwitchError("environment_changed_before_replace");
    }
    await rename(temporary, path);
    temporaryExists = false;
    try {
      await synchronizeDirectory(dirname(path));
      return true;
    } catch {
      return false;
    }
  } catch (error) {
    if (temporaryExists) await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function writePreparedFile(path, bytes, owner) {
  let handle;
  let created = false;
  try {
    handle = await open(
      path,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    created = true;
    const createdStat = await handle.stat();
    if (createdStat.uid !== owner.uid || createdStat.gid !== owner.gid) {
      await handle.chown(owner.uid, owner.gid);
    }
    await handle.chmod(0o600);
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    await handle?.close().catch(() => undefined);
    handle = undefined;
    if (created) await unlink(path).catch(() => undefined);
    throw normalizeError(error, "protected_write_failed");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function syncDirectory(path) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY);
    await handle.sync();
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function assertServiceAccountAccess(stat) {
  const effectiveUser = process.geteuid?.();
  if (effectiveUser === undefined || (effectiveUser !== 0 && effectiveUser !== stat.uid)) {
    throw new SwitchError("service_account_mismatch");
  }
}

async function assertProtectedDirectory(path, targetStat) {
  let directoryStat;
  let resolved;
  try {
    [directoryStat, resolved] = await Promise.all([lstat(path), realpath(path)]);
  } catch (error) {
    throw normalizeError(error, "environment_directory_unavailable");
  }
  if (
    !directoryStat.isDirectory() ||
    directoryStat.isSymbolicLink() ||
    resolved !== resolve(path) ||
    (directoryStat.mode & 0o022) !== 0 ||
    (directoryStat.uid !== 0 && directoryStat.uid !== targetStat.uid)
  ) {
    throw new SwitchError("environment_directory_unprotected");
  }
}

function createReport(status, configuration, rollback) {
  return {
    status,
    names: [...requiredNames],
    configurationDigest: digest(configuration),
    rollbackDigest: digest(rollback),
  };
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function temporaryPath(target) {
  return join(dirname(target), `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`);
}

function hasControl(value) {
  return /[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

function normalizeError(error, fallback) {
  if (error instanceof SwitchError) return error;
  const normalized = new SwitchError(fallback);
  normalized.cause = error;
  return normalized;
}

function parseArguments(argv) {
  const [action, ...rest] = argv;
  if (action !== "switch" && action !== "rollback") {
    throw new SwitchError("invalid_arguments");
  }
  if (rest.length % 2 !== 0) throw new SwitchError("invalid_arguments");
  const names = {
    "--environment-file": "environmentFile",
    "--backup-file": "backupFile",
    "--endpoint-file": "endpointFile",
    "--key-id-file": "keyIdFile",
    "--hmac-secret-file": "hmacSecretFile",
  };
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const property = names[rest[index]];
    if (!property || property in options || !rest[index + 1]) {
      throw new SwitchError("invalid_arguments");
    }
    options[property] = rest[index + 1];
  }
  const allowed =
    action === "switch"
      ? new Set(Object.values(names))
      : new Set(["environmentFile", "backupFile"]);
  if (Object.keys(options).some((name) => !allowed.has(name))) {
    throw new SwitchError("invalid_arguments");
  }
  return { action, options };
}

async function main() {
  try {
    const { action, options } = parseArguments(process.argv.slice(2));
    const report =
      action === "switch" ? await switchAgentTarget(options) : await rollbackAgentTarget(options);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    const normalized = normalizeError(error, "unexpected_failure");
    process.stderr.write(`${JSON.stringify({ status: "failed", code: normalized.code })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
