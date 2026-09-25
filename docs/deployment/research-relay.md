# Research Relay deployment

The Research Relay is an optional Node service for automatic Tabelog score and
reservation enrichment during Add. Browser and Agent Add use the same Owner
application workflow; neither client calls the Relay directly.

## Trust boundaries

- The Cloudflare Owner Worker owns D1, R2, Add state, and signed research
  allowances. It does not receive the DeepSeek or OpenClaw credential.
- The Relay owns search, fetch, DeepSeek extraction, and a replay-only SQLite
  database. It has no D1 or R2 credential.
- OpenClaw Gateway stays on loopback. Its shared bearer credential represents
  operator access and must never be exposed through the public Relay endpoint.
- The public reverse proxy forwards only `POST /v1/research` to the Relay's
  loopback port. A bearer secret and a valid signed allowance are both
  required.

The first source policy accepts only canonical Tabelog restaurant detail URLs.
It rejects search/list/user pages, look-alike hosts, ports, URL credentials,
fragments, and any redirect outside the same reviewed policy. Known Tabelog or
reservation claims are checked against the policy again after extraction.

## Host preparation

1. Install a reviewed OpenClaw release and keep its Gateway on loopback.
2. Explicitly configure an OpenClaw web-search provider. A personal PoC may
   select the bundled key-free DuckDuckGo provider. OpenClaw does not
   automatically select key-free providers.
3. Enable and test the structured `web_search` and `web_fetch` tools locally.
4. Create a service-account-owned directory for the replay SQLite file and a
   protected service environment file. Never place secret values in Git,
   command arguments, screenshots, or chat.
5. Run `packages/research-relay` as a separate service account or a tightly
   scoped service on the same host.

The required and optional environment names are documented in
`packages/research-relay/README.md`. The service binds only to
`127.0.0.1:18791` by default.

## HTTPS and Cloudflare connection

Terminate HTTPS with an operator-controlled reverse proxy or Cloudflare Tunnel.
Use a fixed hostname and expose only `/v1/research`; do not proxy the OpenClaw
Gateway port. The Owner Worker needs:

```text
RESEARCH_RELAY_ENDPOINT=https://<fixed-host>/v1/research
RESEARCH_ALLOWANCE_KEY_VERSION=allowance-v1
RESEARCH_RESULT_KEY_VERSION=result-v1
CATALOG_INTAKE_RESEARCH_RELAY_MODE=relay_enabled_guarded_v1
```

Set these through masked Worker secret prompts:

```text
RESEARCH_RELAY_INGRESS_BEARER_SECRET
RESEARCH_ALLOWANCE_HMAC_SECRET
RESEARCH_RESULT_HMAC_SECRET
```

The allowance secret must match the Relay verifier. The result secret must
match the Relay signer. Use different random values for ingress, allowance,
and result. Key versions are public identifiers, not secrets.

## Evaluation and rollout gate

Keep the checked-in production mode at `relay_disabled_manual_unknown` until:

1. invalid allowance, replay, arbitrary URL, cross-policy redirect, wrong
   branch, prompt injection, timeout, 403, 429, oversized response, and model
   failure tests all fail closed;
2. a live search/fetch/DeepSeek run produces a separate prediction artifact;
3. unsupported claims and unsafe auto-resolution remain zero;
4. the Add flow publishes a confirmed record that is immediately visible to
   both browser and Agent reads;
5. latency and provider usage stay inside the signed phase budgets.

Enable the guarded mode only after these checks. A failed Relay remains an
explicit unknown; it never authorizes a guessed rating or reservation rule.
