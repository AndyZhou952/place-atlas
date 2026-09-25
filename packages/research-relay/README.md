# Japan Atlas Research Relay

This loopback Node service performs the bounded network portion of Catalog
Intake enrichment. It is designed to run on the same host as OpenClaw and to
sit behind a separately managed HTTPS reverse proxy or Cloudflare Tunnel.

The first policy version is intentionally narrow:

- one OpenClaw `web_search` call;
- up to three canonical Tabelog restaurant-detail URLs;
- OpenClaw `web_fetch` with its redirect and SSRF controls;
- DeepSeek extracts only Tabelog score and explicit reservation facts;
- selected Google Place identity remains bound to the signed allowance;
- a persistent SQLite claim is written before any network egress;
- any malformed, unavailable, redirected, conflicting, or unsupported result
  becomes unknown and is never guessed.

The service binds only to `127.0.0.1`. Do not expose the OpenClaw Gateway or
its `/tools/invoke` endpoint publicly. OpenClaw documents its shared bearer
credential as full operator access, so the token must remain in this local
service environment and must never be copied into Cloudflare.

Required service environment names:

```text
RESEARCH_RELAY_INGRESS_BEARER_SECRET
RESEARCH_ALLOWANCE_KEY_VERSION
RESEARCH_ALLOWANCE_HMAC_SECRET
RESEARCH_RESULT_KEY_VERSION
RESEARCH_RESULT_HMAC_SECRET
DEEPSEEK_API_KEY
OPENCLAW_GATEWAY_TOKEN
RESEARCH_RELAY_SQLITE_PATH
```

Optional names:

```text
OPENCLAW_TOOLS_ENDPOINT=http://127.0.0.1:18789/tools/invoke
RESEARCH_RELAY_PORT=18791
```

Configure OpenClaw web search explicitly and verify `web_search` and
`web_fetch` through its local Gateway before starting this service. A key-free
provider can be used for a personal PoC, but it must still be selected
explicitly in OpenClaw. The relay itself never falls back to arbitrary model
browsing or browser automation.

Terminate public HTTPS outside this process and forward only
`POST /v1/research` to `127.0.0.1:$RESEARCH_RELAY_PORT` (default `18791`). Keep the ingress bearer secret in the
reverse proxy/service environment and in the Owner Worker secret store. The
signed allowance remains mandatory even after bearer authentication.

Before enabling Cloudflare traffic, set four public smoke inputs in the local
service environment and run `npm run smoke:live`:

```text
RESEARCH_SMOKE_QUERY
RESEARCH_SMOKE_GOOGLE_PLACE_ID
RESEARCH_SMOKE_NAME
RESEARCH_SMOKE_ADDRESS
```

The smoke command calls only the loopback Relay and prints a verified signed
outcome plus bounded usage. It never prints credentials, raw search results, or
page content.
