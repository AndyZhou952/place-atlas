const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const usageReply =
  "用法：\n/jpmap nearby <街区或地址>\n/jpmap add <餐厅名或地址>\n/jpmap add select <1-3>\n/jpmap add confirm\n/jpmap add cancel";
const urlInputReply = "请复制地图中的街区或地址文字，不要发送链接。";
const configurationReply = "Japan Atlas 配置不可用，请联系管理员。";
const unavailableReply = "Japan Atlas 附近查询暂时不可用，请稍后重试。";
const maximumReplyCharacters = 4_096;
const maximumResponseBytes = 16_384;
const defaultTimeoutMs = 4_000;

export const JPMAP_REQUIRED_SCOPE = "atlas:nearby:read";

export function createJpmapRouterClient(options = {}) {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const nowMs = options.nowMs ?? Date.now;
  const randomUUID = options.randomUUID ?? (() => crypto.randomUUID());
  const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
  const trustedActor = resolveTrustedOwnerCommandContext(options.commandContext, env);

  return async function route(input) {
    const config = readRuntimeConfig(env);
    if (!config || !trustedActor || typeof fetchImpl !== "function") {
      return configurationReply;
    }

    const parsed = parseProjectCommand(input);
    if (parsed.kind === "url") return urlInputReply;
    if (parsed.kind !== "valid") return usageReply;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const timestamp = `${Math.floor(nowMs() / 1_000)}`;
      const mutationId = `jpmap:${randomUUID()}`;
      const nonce = randomUUID();
      if (
        !/^[A-Za-z0-9._:-]{1,160}$/u.test(mutationId) ||
        !/^[A-Za-z0-9._-]{1,128}$/u.test(nonce)
      ) {
        return configurationReply;
      }
      const body = JSON.stringify({
        version: "1",
        projectId: "jpmap",
        tool: parsed.tool,
        mutationId,
        actor: trustedActor,
        input: parsed.input,
      });
      const bodyDigest = await sha256Hex(encoder.encode(body));
      const signature = await hmacSha256Hex(
        config.secret,
        canonicalAgentRequestBytes({
          method: "POST",
          url: config.endpoint,
          bodyDigest,
          timestamp,
          nonce,
          keyId: config.keyId,
        }),
      );
      const response = await fetchImpl(config.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-atlas-key-id": config.keyId,
          "x-atlas-timestamp": timestamp,
          "x-atlas-nonce": nonce,
          "x-atlas-signature": signature,
        },
        body,
        signal: controller.signal,
      });
      if (!response?.ok) return unavailableReply;
      const payload = await readBoundedJson(response);
      return readBoundedReply(payload, mutationId, parsed.operation) ?? unavailableReply;
    } catch {
      return unavailableReply;
    } finally {
      clearTimeout(timeout);
    }
  };
}

export function resolveTrustedOwnerCommandContext(commandContext, env) {
  const actorId = boundedText(env?.JPMAP_OWNER_ACTOR_ID, 256);
  const conversationId = boundedText(env?.JPMAP_OWNER_CONVERSATION_ID, 256);
  if (
    !actorId ||
    !conversationId ||
    !isRecord(commandContext) ||
    commandContext.isAuthorizedSender !== true ||
    commandContext.senderId !== actorId ||
    commandContext.channel !== "openclaw-weixin" ||
    commandContext.channelId !== "openclaw-weixin" ||
    commandContext.from !== conversationId ||
    commandContext.to !== conversationId ||
    (commandContext.messageThreadId !== undefined && commandContext.messageThreadId !== null) ||
    (commandContext.threadParentId !== undefined && commandContext.threadParentId !== null)
  ) {
    return undefined;
  }
  return Object.freeze({
    actorId: commandContext.senderId,
    channel: commandContext.channel,
    conversationId: commandContext.to,
    conversationType: "direct",
  });
}

export function canonicalAgentRequestBytes(request) {
  return [
    request.method.toUpperCase(),
    canonicalPathAndQuery(request.url),
    request.bodyDigest,
    request.timestamp,
    request.nonce,
    request.keyId,
  ].join("\n");
}

function parseProjectCommand(input) {
  if (
    !isRecord(input) ||
    input.commandName !== "jpmap" ||
    input.skillName !== "jpmap" ||
    typeof input.command !== "string" ||
    input.command.length > 1_020 ||
    hasForbiddenControlCharacter(input.command)
  ) {
    return { kind: "invalid" };
  }
  const nearby = /^nearby[ \t]+(.+?\S)[ \t]*$/u.exec(input.command);
  if (nearby) {
    const locationHint = nearby[1].trim();
    if (
      locationHint.length > 1_000 ||
      /(?:^|[ \t])--[A-Za-z0-9_-]+(?:[ \t]|$)/u.test(locationHint)
    ) {
      return { kind: "invalid" };
    }
    if (isUrlShaped(locationHint)) return { kind: "url" };
    return {
      kind: "valid",
      tool: "jpmap_nearby",
      operation: "nearby",
      input: { locationHint },
    };
  }
  const discover = /^add[ \t]+(.+?\S)[ \t]*$/u.exec(input.command);
  const query = discover?.[1]?.trim();
  if (
    query &&
    query.length <= 500 &&
    !/^(?:select|confirm|cancel)(?:[ \t]|$)/u.test(query) &&
    !/(?:^|[ \t])--[A-Za-z0-9_-]+(?:[ \t]|$)/u.test(query)
  ) {
    return {
      kind: "valid",
      tool: "jpmap_add_discover",
      operation: "add",
      input: { query },
    };
  }
  const select = /^add[ \t]+select[ \t]+([1-3])[ \t]*$/u.exec(input.command);
  if (select) {
    return {
      kind: "valid",
      tool: "jpmap_add_select",
      operation: "add",
      input: { ordinal: Number(select[1]) },
    };
  }
  if (/^add[ \t]+confirm[ \t]*$/u.test(input.command)) {
    return { kind: "valid", tool: "jpmap_add_confirm", operation: "add", input: {} };
  }
  if (/^add[ \t]+cancel[ \t]*$/u.test(input.command)) {
    return { kind: "valid", tool: "jpmap_add_cancel", operation: "add", input: {} };
  }
  return { kind: "invalid" };
}

function isUrlShaped(value) {
  return (
    /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(value) ||
    /^(?:www\.)?[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?:[/?#]|$)/u.test(value)
  );
}

function readRuntimeConfig(env) {
  const endpoint = parseEndpoint(env.JPMAP_AGENT_ENDPOINT);
  const keyId = boundedIdentifier(env.JPMAP_AGENT_KEY_ID, 128);
  const secret = boundedText(env.JPMAP_AGENT_HMAC_SECRET, 4_096);
  return endpoint && keyId && secret ? { endpoint, keyId, secret } : undefined;
}

function parseEndpoint(value) {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/api/agent/v1/tools"
    ) {
      return undefined;
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function boundedIdentifier(value, maximumLength) {
  return typeof value === "string" &&
    value.length <= maximumLength &&
    /^[A-Za-z0-9._-]+$/u.test(value)
    ? value
    : undefined;
}

function boundedText(value, maximumLength) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    !hasForbiddenControlCharacter(value)
    ? value
    : undefined;
}

async function readBoundedJson(response) {
  const declaredLength = response.headers?.get?.("content-length");
  if (declaredLength !== null && declaredLength !== undefined) {
    if (!/^\d+$/u.test(declaredLength)) return undefined;
    if (Number(declaredLength) > maximumResponseBytes) return undefined;
  }
  const reader = response.body?.getReader?.();
  if (!reader) return undefined;

  const chunks = [];
  let byteLength = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    if (!(next.value instanceof Uint8Array)) return undefined;
    byteLength += next.value.byteLength;
    if (byteLength > maximumResponseBytes) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch {
    return undefined;
  }
}

function readBoundedReply(payload, mutationId, operation) {
  if (
    !isRecord(payload) ||
    payload.ok !== true ||
    !isRecord(payload.receipt) ||
    payload.receipt.mutationId !== mutationId ||
    !/^[a-f0-9]{64}$/u.test(payload.receipt.payloadDigest) ||
    typeof payload.receipt.replayed !== "boolean" ||
    !isRecord(payload.receipt.result) ||
    payload.receipt.result.projectId !== "jpmap" ||
    payload.receipt.result.operation !== operation
  ) {
    return undefined;
  }
  const text = payload.receipt.result.replyText;
  return typeof text === "string" &&
    text.length > 0 &&
    text.length <= maximumReplyCharacters &&
    !hasForbiddenReplyControlCharacter(text)
    ? text
    : undefined;
}

function hasForbiddenControlCharacter(value) {
  return [...value].some((character) => {
    const code = character.codePointAt(0);
    return code < 32 || code === 127;
  });
}

function hasForbiddenReplyControlCharacter(value) {
  return [...value].some((character) => {
    const code = character.codePointAt(0);
    return (code < 32 && code !== 9 && code !== 10) || code === 127;
  });
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(new Uint8Array(digest));
}

async function hmacSha256Hex(secret, canonicalBytes) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(canonicalBytes));
  return bytesToHex(new Uint8Array(signature));
}

function canonicalPathAndQuery(input) {
  const url = new URL(input);
  const parameters = [...url.searchParams.entries()].sort(
    ([leftName, leftValue], [rightName, rightValue]) =>
      leftName.localeCompare(rightName) || leftValue.localeCompare(rightValue),
  );
  const query = new URLSearchParams(parameters).toString();
  return `${url.pathname}${query ? `?${query}` : ""}`;
}

function bytesToHex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}
