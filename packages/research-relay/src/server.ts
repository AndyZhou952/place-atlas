import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

import { createDeepSeekResearchScalarExtractor } from "../../../apps/web/adapters/research-relay/openai-compatible-research-scalar-extractor.ts";
import { createOpenClawGatewayResearchAdapters } from "../../../apps/web/adapters/research-relay/openclaw-gateway-research-adapter.ts";
import { createResearchRelayHandler } from "../../../apps/web/adapters/research-relay/research-relay-handler.ts";
import {
  createResearchRelayHttpEntry,
  inspectResearchRelayRequestHeaders,
} from "../../../apps/web/adapters/research-relay/research-relay-http-entry.ts";
import {
  researchRelayReplaySchemaSql,
  SqliteResearchRelayReplayGuard,
} from "../../../apps/web/adapters/research-relay/research-relay-replay-guard.ts";
import { createTabelogResearchSourcePolicy } from "../../../apps/web/adapters/research-relay/research-source-policy.ts";
import { createDirectWebResearchAdapters } from "./direct-web-research-adapter.ts";

const maximumHttpRequestBytes = 32 * 1024;
const requestTimeoutMs = 15_000;
const headersTimeoutMs = 5_000;
const keepAliveTimeoutMs = 5_000;

export function createResearchRelayServer(
  environment: NodeJS.ProcessEnv,
  overrides: {
    readonly fetch?: typeof fetch;
    readonly now?: () => Date;
  } = {},
) {
  const configuration = readConfiguration(environment);
  const now = overrides.now ?? (() => new Date());
  const sourcePolicy = createTabelogResearchSourcePolicy();
  const researchAdapters =
    configuration.webProvider === "direct_duckduckgo"
      ? createDirectWebResearchAdapters({ sourcePolicy })
      : createOpenClawGatewayResearchAdapters({
          endpoint: configuration.openClawEndpoint,
          token: configuration.openClawToken,
          sourcePolicy,
          ...(overrides.fetch ? { fetch: overrides.fetch } : {}),
        });
  const extractor = createDeepSeekResearchScalarExtractor({
    apiKey: configuration.deepSeekApiKey,
    ...(overrides.fetch ? { fetch: overrides.fetch } : {}),
  });
  const sqlite = new DatabaseSync(configuration.sqlitePath);
  let sqliteClosed = false;
  const disposeSqlite = () => {
    if (sqliteClosed) return;
    sqliteClosed = true;
    sqlite.close();
  };
  try {
    sqlite.exec(researchRelayReplaySchemaSql);
  } catch (error) {
    disposeSqlite();
    throw error;
  }
  const replayGuard = new SqliteResearchRelayReplayGuard({
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        run(...values) {
          const result = statement.run(...(values as Parameters<typeof statement.run>));
          return { changes: Number(result.changes) };
        },
        get(...values) {
          return statement.get(...(values as Parameters<typeof statement.get>));
        },
      };
    },
  });
  const relay = createResearchRelayHandler({
    allowanceKeys: {
      [configuration.allowanceKeyVersion]: configuration.allowanceSecret,
    },
    resultKey: {
      keyVersion: configuration.resultKeyVersion,
      secret: configuration.resultSecret,
    },
    now,
    replayGuard,
    searchTool: researchAdapters.searchTool,
    transport: researchAdapters.transport,
    extractor,
    sourcePolicy,
  });
  const entry = createResearchRelayHttpEntry({
    bearerSecret: configuration.ingressBearerSecret,
    relay,
    cleanup: () => replayGuard.cleanup(now()),
  });
  const server = createServer((request, response) => {
    void handleHttpRequest(request, response, entry, configuration.ingressBearerSecret).catch(() =>
      rejectBrokenRequest(request, response),
    );
  });
  server.headersTimeout = headersTimeoutMs;
  server.requestTimeout = requestTimeoutMs;
  server.keepAliveTimeout = keepAliveTimeoutMs;
  server.maxHeadersCount = 32;
  server.setTimeout(requestTimeoutMs, (socket) => socket.destroy());
  server.on("clientError", (_error, socket) => {
    if (socket.writable) {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    } else {
      socket.destroy();
    }
  });

  let lifecycle: "created" | "starting" | "listening" | "closing" | "closed" | "failed" = "created";
  let listenPromise: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;
  const close = () => {
    if (closePromise) return closePromise;
    lifecycle = "closing";
    closePromise = (async () => {
      try {
        if (listenPromise) {
          await listenPromise.catch(() => undefined);
        }
        if (!server.listening) return;
        await new Promise<void>((resolveClose, rejectClose) => {
          server.close((error) => {
            if (error) rejectClose(error);
            else resolveClose();
          });
          server.closeIdleConnections();
        });
      } finally {
        disposeSqlite();
        lifecycle = "closed";
      }
    })();
    return closePromise;
  };
  const host = "127.0.0.1" as const;
  const listen = () => {
    if (lifecycle === "listening") return Promise.resolve();
    if (lifecycle === "starting" && listenPromise) return listenPromise;
    if (lifecycle !== "created") {
      return Promise.reject(new TypeError("Research Relay server cannot be restarted."));
    }
    lifecycle = "starting";
    listenPromise = new Promise<void>((resolveListen, rejectListen) => {
      const onError = (error: Error) => {
        server.off("listening", onListening);
        lifecycle = "failed";
        disposeSqlite();
        rejectListen(error);
      };
      const onListening = () => {
        server.off("error", onError);
        if (lifecycle === "starting") lifecycle = "listening";
        resolveListen();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(configuration.port, host);
    });
    return listenPromise;
  };
  return { server, port: configuration.port, host, listen, close };
}

async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  entry: ReturnType<typeof createResearchRelayHttpEntry>,
  bearerSecret: string,
) {
  const authorization = readSingleHeader(request.headers.authorization);
  const contentType = readContentType(request.headers["content-type"]);
  const headers = {
    method: request.method ?? "",
    path: request.url ?? "",
    ...(authorization ? { authorization } : {}),
    ...(contentType ? { contentType } : {}),
  };
  const headerRejection = inspectResearchRelayRequestHeaders(headers, bearerSecret);
  if (headerRejection) {
    rejectWithoutReading(request, response, headerRejection);
    return;
  }
  const declared = request.headers["content-length"];
  if (
    declared !== undefined &&
    (Array.isArray(declared) ||
      !/^\d+$/u.test(declared) ||
      Number(declared) > maximumHttpRequestBytes)
  ) {
    rejectWithoutReading(request, response, invalidRequestResponse());
    return;
  }
  const body = await readRequestBody(request);
  if (!body) {
    rejectWithoutReading(request, response, invalidRequestResponse());
    return;
  }
  const result = await entry.handle({ ...headers, body });
  writeResponse(response, result);
}

function readRequestBody(request: IncomingMessage): Promise<Uint8Array | undefined> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Uint8Array[] = [];
    let total = 0;
    let settled = false;
    const cleanup = () => {
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("aborted", onAborted);
      request.off("error", onError);
    };
    const settle = (value: Uint8Array | undefined) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolveBody(value);
    };
    const onData = (chunk: Buffer | string) => {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      total += bytes.byteLength;
      if (total > maximumHttpRequestBytes) {
        request.pause();
        settle(undefined);
        return;
      }
      chunks.push(bytes);
    };
    const onEnd = () => settle(Buffer.concat(chunks, total));
    const onAborted = () => {
      if (settled) return;
      settled = true;
      cleanup();
      rejectBody(new TypeError("Research Relay request was aborted."));
    };
    const onError = () => onAborted();
    request.on("data", onData);
    request.once("end", onEnd);
    request.once("aborted", onAborted);
    request.once("error", onError);
  });
}

function rejectWithoutReading(
  request: IncomingMessage,
  response: ServerResponse,
  result: Parameters<typeof writeResponse>[1],
) {
  request.pause();
  response.shouldKeepAlive = false;
  response.once("finish", () => request.destroy());
  writeResponse(response, result, true);
}

function rejectBrokenRequest(request: IncomingMessage, response: ServerResponse) {
  if (!response.headersSent && !response.destroyed) {
    rejectWithoutReading(request, response, invalidRequestResponse());
  } else {
    response.destroy();
    request.destroy();
  }
}

function invalidRequestResponse() {
  return {
    status: 400,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status: "rejected", reason: "invalid_request" }),
  };
}

function writeResponse(
  response: ServerResponse,
  result: {
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
  },
  closeConnection = false,
) {
  response.writeHead(result.status, {
    ...result.headers,
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(result.body),
    "x-content-type-options": "nosniff",
    ...(closeConnection ? { connection: "close" } : {}),
  });
  response.end(result.body);
}

function readConfiguration(environment: NodeJS.ProcessEnv) {
  const values = {
    ingressBearerSecret: requiredSecret(environment.RESEARCH_RELAY_INGRESS_BEARER_SECRET),
    allowanceKeyVersion: requiredIdentifier(environment.RESEARCH_ALLOWANCE_KEY_VERSION),
    allowanceSecret: requiredSecret(environment.RESEARCH_ALLOWANCE_HMAC_SECRET),
    resultKeyVersion: requiredIdentifier(environment.RESEARCH_RESULT_KEY_VERSION),
    resultSecret: requiredSecret(environment.RESEARCH_RESULT_HMAC_SECRET),
    deepSeekApiKey: requiredSecret(environment.DEEPSEEK_API_KEY),
    webProvider: environment.RESEARCH_WEB_PROVIDER ?? "direct_duckduckgo",
    openClawEndpoint: environment.OPENCLAW_TOOLS_ENDPOINT ?? "http://127.0.0.1:18789/tools/invoke",
    openClawToken: environment.OPENCLAW_GATEWAY_TOKEN,
    sqlitePath: environment.RESEARCH_RELAY_SQLITE_PATH,
    port: Number(environment.RESEARCH_RELAY_PORT ?? "18791"),
  };
  if (
    !["direct_duckduckgo", "openclaw_gateway"].includes(values.webProvider) ||
    (values.webProvider === "openclaw_gateway" && !validSecret(values.openClawToken)) ||
    typeof values.sqlitePath !== "string" ||
    !isAbsolute(values.sqlitePath) ||
    values.sqlitePath === "/" ||
    !Number.isInteger(values.port) ||
    values.port < 1_024 ||
    values.port > 65_535
  ) {
    throw new TypeError("Research Relay configuration is invalid.");
  }
  return {
    ...values,
    webProvider: values.webProvider as "direct_duckduckgo" | "openclaw_gateway",
    openClawToken: values.openClawToken ?? "",
    sqlitePath: values.sqlitePath,
  };
}

function requiredSecret(value: string | undefined): string {
  if (!validSecret(value)) {
    throw new TypeError("Research Relay configuration is invalid.");
  }
  return value;
}

function validSecret(value: string | undefined): value is string {
  return (
    typeof value === "string" &&
    value.length >= 32 &&
    value.length <= 4_096 &&
    !hasAsciiControlCharacter(value)
  );
}

function requiredIdentifier(value: string | undefined): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,64}$/u.test(value)) {
    throw new TypeError("Research Relay configuration is invalid.");
  }
  return value;
}

function readSingleHeader(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function readContentType(value: string | string[] | undefined) {
  if (typeof value !== "string") return undefined;
  return /^application\/json(?:\s*;|$)/iu.test(value) ? "application/json" : value;
}

function hasAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const relay = createResearchRelayServer(process.env);
  try {
    await relay.listen();
    process.stdout.write(
      JSON.stringify({
        event: "research_relay_started",
        host: relay.host,
        port: relay.port,
        sourcePolicy: "tabelog-detail-v1",
      }) + "\n",
    );
    let shuttingDown = false;
    const shutdown = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      void relay.close().catch(() => {
        process.exitCode = 1;
      });
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  } catch {
    await relay.close();
    process.stderr.write("Research Relay failed to start.\n");
    process.exitCode = 1;
  }
}
