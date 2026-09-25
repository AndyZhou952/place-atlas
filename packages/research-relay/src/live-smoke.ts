import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  signResearchAllowance,
  verifyResearchResult,
} from "../../../apps/web/adapters/research-relay/research-relay-envelope.ts";
import { deriveCatalogIntakeResearchInputDigest } from "../../../apps/web/product/application/catalog-intake/catalog-intake-coordinator.ts";

const maximumResponseBytes = 64 * 1024;

export async function runResearchRelayLiveSmoke(
  environment: NodeJS.ProcessEnv,
  dependencies: {
    readonly fetch?: typeof fetch;
    readonly now?: () => Date;
    readonly requestId?: () => string;
  } = {},
) {
  const now = dependencies.now?.() ?? new Date();
  const subject = {
    ownerQuery: requiredPublicText(environment.RESEARCH_SMOKE_QUERY),
    providerNamespace: "google-places",
    placeId: requiredPublicText(environment.RESEARCH_SMOKE_GOOGLE_PLACE_ID),
    transientName: requiredPublicText(environment.RESEARCH_SMOKE_NAME),
    transientAddress: requiredPublicText(environment.RESEARCH_SMOKE_ADDRESS),
  } as const;
  const allowanceKey = {
    keyVersion: requiredIdentifier(environment.RESEARCH_ALLOWANCE_KEY_VERSION),
    secret: requiredSecret(environment.RESEARCH_ALLOWANCE_HMAC_SECRET),
  };
  const resultKeyVersion = requiredIdentifier(environment.RESEARCH_RESULT_KEY_VERSION);
  const resultSecret = requiredSecret(environment.RESEARCH_RESULT_HMAC_SECRET);
  const ingressSecret = requiredSecret(environment.RESEARCH_RELAY_INGRESS_BEARER_SECRET);
  const relayPort = requiredPort(environment.RESEARCH_RELAY_PORT ?? "18791");
  const queryOrUrlsDigest = await deriveCatalogIntakeResearchInputDigest({
    phase: "initial",
    selectedSubject: subject,
  });
  if (!queryOrUrlsDigest) throw configurationError();
  const allowance = {
    sessionId: `live-smoke-${(dependencies.requestId ?? randomUUID)()}`,
    phase: "initial" as const,
    queryOrUrlsDigest,
    maxCounts: { searchQueries: 1 as const, pageRequests: 3 as const },
    maxDurationMs: 35_000,
    requestTimeoutMs: 15_000,
    maxRedirects: 3,
    deadline: new Date(now.getTime() + 35_000).toISOString(),
    requestId: (dependencies.requestId ?? randomUUID)(),
  };
  const signedAllowance = await signResearchAllowance({
    allowance,
    key: allowanceKey,
    now,
  });
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Live smoke deadline exceeded.", "TimeoutError")),
    35_000,
  );
  try {
    const response = await (dependencies.fetch ?? fetch)(
      `http://127.0.0.1:${relayPort}/v1/research`,
      {
        method: "POST",
        redirect: "error",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${ingressSecret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          allowance: signedAllowance,
          payload: { phase: "initial", subject },
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok || response.status !== 200) throw smokeFailure();
    const envelope = await readBoundedJson(response);
    if (!isRecord(envelope) || envelope.status !== "ok" || !Object.hasOwn(envelope, "result")) {
      throw smokeFailure();
    }
    const observedAt = dependencies.now?.() ?? new Date();
    const verified = await verifyResearchResult(envelope.result, {
      keys: { [resultKeyVersion]: resultSecret },
      now: observedAt,
      allowance,
      allowanceDigest: signedAllowance.allowanceDigest,
    });
    if (!verified) throw smokeFailure();
    return {
      status: "verified" as const,
      outcome: verified.outcome,
      usage: verified.usage,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw smokeFailure();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumResponseBytes) {
      await reader.cancel();
      throw smokeFailure();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    throw smokeFailure();
  }
}

function requiredPublicText(value: string | undefined): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 500 ||
    value.normalize("NFC").trim() !== value ||
    hasAsciiControlCharacter(value)
  ) {
    throw configurationError();
  }
  return value;
}

function requiredSecret(value: string | undefined): string {
  if (
    typeof value !== "string" ||
    value.length < 32 ||
    value.length > 4_096 ||
    hasAsciiControlCharacter(value)
  ) {
    throw configurationError();
  }
  return value;
}

function requiredIdentifier(value: string | undefined): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._-]{1,64}$/u.test(value)) {
    throw configurationError();
  }
  return value;
}

function requiredPort(value: string): number {
  if (!/^\d+$/u.test(value)) throw configurationError();
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1_024 || port > 65_535) {
    throw configurationError();
  }
  return port;
}

function hasAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function configurationError() {
  return new TypeError("Research Relay live-smoke configuration is invalid.");
}

function smokeFailure() {
  return new TypeError("Research Relay live smoke failed closed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await runResearchRelayLiveSmoke(process.env);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
