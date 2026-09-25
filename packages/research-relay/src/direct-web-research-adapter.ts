import { resolve4, resolve6 } from "node:dns/promises";
import { request as httpsRequest } from "node:https";

import {
  createHardenedResearchTransport,
  type PinnedHttpsConnectorPort,
  type ResearchDnsPort,
} from "../../../apps/web/adapters/research-relay/hardened-research-transport.ts";
import type { ResearchUrlSearchPort } from "../../../apps/web/adapters/research-relay/research-relay-handler.ts";
import type { ResearchSourcePolicy } from "../../../apps/web/adapters/research-relay/research-source-policy.ts";

const duckDuckGoHost = "html.duckduckgo.com";
const maximumQueryCharacters = 500;
const maximumSearchResults = 3;
const maximumSearchLinks = 30;
const maximumEvidenceBytes = 60 * 1024;

export function createDirectWebResearchAdapters(dependencies: {
  readonly sourcePolicy: ResearchSourcePolicy;
  readonly dns?: ResearchDnsPort;
  readonly connector?: PinnedHttpsConnectorPort;
  readonly now?: () => number;
}): {
  readonly searchTool: ResearchUrlSearchPort;
  readonly transport: ReturnType<typeof createHardenedResearchTransport>;
} {
  const dns = dependencies.dns ?? createNodeResearchDns();
  const connector = dependencies.connector ?? createNodePinnedHttpsConnector();
  const searchTransport = createHardenedResearchTransport({
    dns,
    connector,
    sourcePolicy: createDuckDuckGoSearchPolicy(),
    ...(dependencies.now ? { now: dependencies.now } : {}),
  });
  const rawPageTransport = createHardenedResearchTransport({
    dns,
    connector,
    sourcePolicy: dependencies.sourcePolicy,
    ...(dependencies.now ? { now: dependencies.now } : {}),
  });
  const pageTransport: ReturnType<typeof createHardenedResearchTransport> = {
    async get(url, limits) {
      const result = await rawPageTransport.get(url, limits);
      return result.status === "ok"
        ? { ...result, body: createBoundedTabelogEvidence(result.body) }
        : result;
    },
  };
  return {
    searchTool: {
      async search(input) {
        const query = normalizeQuery(input.query);
        if (
          !query ||
          input.maxResults !== maximumSearchResults ||
          input.signal.aborted ||
          Date.now() >= input.deadlineAtMs
        ) {
          throw new TypeError("Direct web search request is invalid.");
        }
        const searchUrl = new URL(`https://${duckDuckGoHost}/html`);
        searchUrl.searchParams.set("q", `${query} site:tabelog.com`);
        searchUrl.searchParams.set("kp", "-1");
        const result = await searchTransport.get(searchUrl.toString(), {
          timeoutMs: Math.min(10_000, input.deadlineAtMs - Date.now()),
          maxRedirects: 0,
          deadlineAtMs: input.deadlineAtMs,
          signal: input.signal,
        });
        if (result.status !== "ok") {
          throw new TypeError("Direct web search is unavailable.");
        }
        return {
          urls: extractTabelogDetailUrls(result.body, dependencies.sourcePolicy),
        };
      },
    },
    transport: pageTransport,
  };
}

export function createNodeResearchDns(): ResearchDnsPort {
  return {
    async resolve(hostname, input) {
      if (input.signal.aborted || Date.now() >= input.deadlineAtMs) {
        throw new DOMException("DNS deadline exceeded.", "TimeoutError");
      }
      const [a, aaaa] = await Promise.all([
        resolveFamily(hostname, "ipv4"),
        resolveFamily(hostname, "ipv6"),
      ]);
      return { a, aaaa };
    },
  };
}

export function createNodePinnedHttpsConnector(): PinnedHttpsConnectorPort {
  return {
    request(input) {
      if (input.followRedirects !== false || input.retry !== false) {
        return Promise.reject(new TypeError("Pinned HTTPS request is invalid."));
      }
      const url = new URL(input.url);
      if (
        url.protocol !== "https:" ||
        url.hostname !== input.tlsServerName ||
        input.hostHeader !== input.tlsServerName
      ) {
        return Promise.reject(new TypeError("Pinned HTTPS request is invalid."));
      }
      return new Promise((resolveRequest, rejectRequest) => {
        const request = httpsRequest(
          {
            protocol: "https:",
            hostname: input.pinnedIp,
            port: 443,
            method: "GET",
            path: `${url.pathname}${url.search}`,
            servername: input.tlsServerName,
            rejectUnauthorized: true,
            agent: false,
            maxHeaderSize: 32_768,
            signal: input.signal,
            headers: {
              Accept: "text/html,application/xhtml+xml",
              "Accept-Encoding": "identity",
              Host: input.hostHeader,
              "User-Agent":
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            },
          },
          (response) => {
            const status = response.statusCode;
            const connectedIp = normalizeSocketIp(response.socket.remoteAddress);
            if (!status || !connectedIp) {
              response.destroy();
              rejectRequest(new TypeError("Pinned HTTPS response is invalid."));
              return;
            }
            resolveRequest({
              status,
              headers: normalizeResponseHeaders(response.headers),
              connectedIp,
              body: response,
            });
          },
        );
        request.maxHeadersCount = 100;
        request.setTimeout(input.timeoutMs, () => {
          request.destroy(new DOMException("HTTPS request timed out.", "TimeoutError"));
        });
        request.once("error", rejectRequest);
        request.end();
      });
    },
  };
}

function createDuckDuckGoSearchPolicy(): ResearchSourcePolicy {
  const canonicalize = (value: string) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return undefined;
    }
    if (
      url.protocol !== "https:" ||
      url.hostname !== duckDuckGoHost ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      url.pathname !== "/html" ||
      url.hash !== "" ||
      [...url.searchParams.keys()].some((key) => key !== "q" && key !== "kp") ||
      url.searchParams.get("kp") !== "-1" ||
      !validSearchQuery(url.searchParams.get("q") ?? "")
    ) {
      return undefined;
    }
    return url.toString();
  };
  return {
    canonicalize,
    authorizeCandidate: canonicalize,
    authorizeRedirect() {
      return undefined;
    },
    authorizeClaim() {
      return undefined;
    },
  };
}

function extractTabelogDetailUrls(html: string, policy: ResearchSourcePolicy): readonly string[] {
  const candidates = new Map<string, string>();
  const resultLink = /<a\b(?=[^>]*\bclass="[^"]*\bresult__a\b[^"]*")([^>]*)>/giu;
  let inspectedLinks = 0;
  for (const match of html.matchAll(resultLink)) {
    inspectedLinks += 1;
    if (inspectedLinks > maximumSearchLinks) break;
    const attributes = match[1];
    if (!attributes) continue;
    const rawUrl = /\bhref="([^"]*)"/iu.exec(attributes)?.[1];
    if (!rawUrl) continue;
    const candidate = unwrapDuckDuckGoUrl(decodeHtmlAttribute(rawUrl));
    if (!candidate) continue;
    const canonical = policy.authorizeCandidate(candidate);
    if (!canonical) continue;
    const identity = tabelogRestaurantIdentity(canonical);
    if (!identity) continue;
    const current = candidates.get(identity);
    if (!current || tabelogLocalePreference(canonical) < tabelogLocalePreference(current)) {
      candidates.set(identity, canonical);
    }
  }
  return [...candidates.values()].slice(0, maximumSearchResults);
}

function tabelogRestaurantIdentity(value: string): string | undefined {
  return new URL(value).pathname.match(/\/(\d+)\/?$/u)?.[1];
}

function tabelogLocalePreference(value: string): number {
  const firstSegment = new URL(value).pathname.split("/").filter(Boolean)[0];
  return firstSegment && /^[a-z]{2}(?:-[a-z]{2})?$/iu.test(firstSegment) ? 1 : 0;
}

function createBoundedTabelogEvidence(html: string): string {
  const metadata: string[] = [];
  for (const match of html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title>/giu)) {
    if (match[1]) metadata.push(`Title: ${stripMarkup(match[1])}`);
  }
  for (const match of html.matchAll(/<meta\b([^>]*)>/giu)) {
    const attributes = match[1] ?? "";
    const key = readHtmlAttribute(attributes, "name") ?? readHtmlAttribute(attributes, "property");
    if (!key || !/^(?:description|og:title|og:description)$/iu.test(key)) continue;
    const content = readHtmlAttribute(attributes, "content");
    if (content) metadata.push(`${key}: ${decodeHtmlText(content)}`);
  }
  for (const match of html.matchAll(
    /<script\b(?=[^>]*\btype=["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/giu,
  )) {
    if (match[1]) metadata.push(`Structured data: ${decodeHtmlText(match[1])}`);
  }

  const visibleText = stripMarkup(
    html
      .replace(/<!--([\s\S]*?)-->/gu, " ")
      .replace(
        /<(?:script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript|svg|template)>/giu,
        " ",
      )
      .replace(/<(?:br|hr)\b[^>]*>/giu, "\n")
      .replace(/<\/(?:p|div|section|article|li|tr|h[1-6])>/giu, "\n"),
  );
  const evidence = [...metadata, "Visible page text:", visibleText]
    .filter((value) => value.length > 0)
    .join("\n");
  return truncateUtf8(evidence || "No readable evidence.", maximumEvidenceBytes);
}

function stripMarkup(value: string): string {
  return decodeHtmlText(value.replace(/<[^>]*>/gu, " "))
    .replace(/[\t\f\v ]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function readHtmlAttribute(attributes: string, name: string): string | undefined {
  const quoted = new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "iu").exec(attributes)?.[2];
  return quoted || undefined;
}

function decodeHtmlText(value: string): string {
  return value
    .replace(/&#(x[0-9a-f]+|\d+);/giu, (entity, code: string) => {
      const numeric = code.toLowerCase().startsWith("x")
        ? Number.parseInt(code.slice(1), 16)
        : Number.parseInt(code, 10);
      return Number.isSafeInteger(numeric) && numeric >= 0 && numeric <= 0x10ffff
        ? String.fromCodePoint(numeric)
        : entity;
    })
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'");
}

function truncateUtf8(value: string, maximumBytes: number): string {
  const encoder = new TextEncoder();
  let bytes = 0;
  let result = "";
  for (const character of value) {
    const width = encoder.encode(character).byteLength;
    if (bytes + width > maximumBytes) break;
    result += character;
    bytes += width;
  }
  return result;
}

function unwrapDuckDuckGoUrl(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value, `https://${duckDuckGoHost}/`);
  } catch {
    return undefined;
  }
  if (
    (url.hostname === "duckduckgo.com" || url.hostname === duckDuckGoHost) &&
    url.pathname === "/l/"
  ) {
    return url.searchParams.get("uddg") ?? undefined;
  }
  return url.toString();
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&#x2F;", "/")
    .replaceAll("&#47;", "/")
    .replaceAll("&quot;", '"');
}

function normalizeQuery(value: string): string | undefined {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumQueryCharacters ||
    value.normalize("NFC").trim() !== value ||
    hasAsciiControlCharacter(value)
  ) {
    return undefined;
  }
  return value;
}

function validSearchQuery(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= maximumQueryCharacters + 20 &&
    value.normalize("NFC").trim() === value &&
    !hasAsciiControlCharacter(value) &&
    value.endsWith(" site:tabelog.com")
  );
}

function hasAsciiControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

async function resolveFamily(hostname: string, family: "ipv4" | "ipv6") {
  try {
    const addresses = family === "ipv4" ? await resolve4(hostname) : await resolve6(hostname);
    return addresses.length > 0
      ? { status: "ok" as const, addresses }
      : { status: "nodata" as const };
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENODATA" || error.code === "ENOTFOUND")
    ) {
      return { status: "nodata" as const };
    }
    throw error;
  }
}

function normalizeResponseHeaders(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
): Readonly<Record<string, string>> {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "string") normalized[name.toLowerCase()] = value;
    else if (Array.isArray(value)) normalized[name.toLowerCase()] = value.join(", ");
  }
  return normalized;
}

function normalizeSocketIp(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/iu);
  return mapped?.[1] ?? value.replace(/%.+$/u, "");
}
