import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createTabelogResearchSourcePolicy } from "../../../apps/web/adapters/research-relay/research-source-policy.ts";
import { createDirectWebResearchAdapters } from "./direct-web-research-adapter.ts";

export async function runDirectWebSmoke(environment: NodeJS.ProcessEnv) {
  const query = requiredPublicText(environment.RESEARCH_SMOKE_QUERY);
  const adapters = createDirectWebResearchAdapters({
    sourcePolicy: createTabelogResearchSourcePolicy(),
  });
  const controller = new AbortController();
  const deadlineAtMs = Date.now() + 20_000;
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Web smoke deadline exceeded.", "TimeoutError")),
    20_000,
  );
  try {
    const search = await adapters.searchTool.search({
      query,
      maxResults: 3,
      signal: controller.signal,
      deadlineAtMs,
    });
    if (!isRecord(search) || !Array.isArray(search.urls) || search.urls.length === 0) {
      throw smokeFailure();
    }
    const firstUrl = search.urls[0];
    if (typeof firstUrl !== "string") throw smokeFailure();
    const fetched = await adapters.transport.get(firstUrl, {
      timeoutMs: 15_000,
      maxRedirects: 3,
      deadlineAtMs,
      signal: controller.signal,
    });
    if (fetched.status !== "ok") throw smokeFailure();
    return {
      status: "verified" as const,
      candidates: search.urls,
      fetched: {
        url: fetched.finalUrl,
        bodyBytes: new TextEncoder().encode(fetched.body).byteLength,
        requestCount: fetched.requestCount,
        redirectsFollowed: fetched.redirectsFollowed,
      },
    };
  } finally {
    clearTimeout(timeout);
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
    throw new TypeError("Direct web smoke configuration is invalid.");
  }
  return value;
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

function smokeFailure() {
  return new TypeError("Direct web smoke failed closed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await runDirectWebSmoke(process.env);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
