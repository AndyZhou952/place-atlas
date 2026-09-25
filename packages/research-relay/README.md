# Japan Atlas Research Relay

This repository-owned Node Agent Service performs the bounded network portion
of Catalog Intake enrichment. It runs independently of browser and channel
clients and sits behind a separately managed HTTPS reverse proxy or Cloudflare
Tunnel.

The first policy version is intentionally narrow:

- one fixed-endpoint DuckDuckGo HTML search request;
- up to three canonical Tabelog restaurant-detail URLs;
- pinned-DNS HTTPS fetches with redirect, response-size, and SSRF controls;
- DeepSeek extracts only Tabelog score and explicit reservation facts;
- selected Google Place identity remains bound to the signed allowance;
- a persistent SQLite claim is written before any network egress;
- any malformed, unavailable, conflicting, unsupported, cross-policy, or
  cross-restaurant redirect becomes unknown and is never guessed; a reviewed
  redirect may be followed only when it still identifies the same restaurant.

The service binds only to `127.0.0.1`. Browser Add and signed Agent clients use
the same Owner API; neither client calls this service directly. OpenClaw is an
optional channel adapter and is not required by the default Agent Service.

Required service environment names:

```text
RESEARCH_RELAY_INGRESS_BEARER_SECRET
RESEARCH_ALLOWANCE_KEY_VERSION
RESEARCH_ALLOWANCE_HMAC_SECRET
RESEARCH_RESULT_KEY_VERSION
RESEARCH_RESULT_HMAC_SECRET
DEEPSEEK_API_KEY
RESEARCH_RELAY_SQLITE_PATH
```

Optional names:

```text
RESEARCH_WEB_PROVIDER=direct_duckduckgo
RESEARCH_RELAY_PORT=18791
```

`direct_duckduckgo` is the default and needs no search credential. It uses only
the fixed DuckDuckGo HTML endpoint and accepts only canonical Tabelog detail
results. For compatibility testing, `RESEARCH_WEB_PROVIDER=openclaw_gateway`
is available and additionally requires `OPENCLAW_GATEWAY_TOKEN`; it is not the
default product architecture.

Install production dependencies in both `apps/web` and
`packages/research-relay`. The service imports shared domain and security code
from the repository rather than copying those rules into a second package.

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
