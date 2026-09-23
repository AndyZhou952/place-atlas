# Japan Atlas OpenClaw PoC client

This package is the read-only OpenClaw 2026.7.1 client for the canonical
`/jpmap nearby <manual address or area>` command. It registers one native
plugin command that OpenClaw executes before agent/model invocation. It does
not register or ship any model-selectable tool or skill.

Do not install this package until the isolated Worker endpoint and R2-backed
T-03 environment are approved and available.

## Local verification

From this directory:

```bash
npm test
npm run lint
npm run build
npm pack --dry-run
```

The build copies reviewed ESM runtime files into `dist/`; the package manifest
ships only `dist/`, the OpenClaw manifest, the host preflight, and this
runbook.

## Runtime secrets and identity binding

Supply these variables to the OpenClaw Gateway process through its root-only
service environment file or equivalent secret manager:

```text
JPMAP_AGENT_ENDPOINT=https://<isolated-worker-host>/api/agent/v1/tools
JPMAP_AGENT_KEY_ID=<read-only-key-id>
JPMAP_AGENT_HMAC_SECRET=<random-hmac-secret>
JPMAP_OWNER_ACTOR_ID=<owner-actor-id>
JPMAP_OWNER_CONVERSATION_ID=<owner-direct-message-id>
```

Do not place values in this repository, `openclaw.json`, shell history, logs,
or chat. The endpoint must be HTTPS and contain no URL credentials, query, or
fragment. Provision the matching Worker key for project `jpmap`, owner
channel `openclaw-weixin`, conversation type `direct`, and only
`atlas:nearby:read`. The server remains the authority for scope checks.

The environment owner values are comparisons only. The signed request actor is
taken from OpenClaw's runtime-supplied command context after `requireAuth` and
exact sender ID, `openclaw-weixin` channel/channel ID, direct-message from/to,
and no-thread checks. The external plugin does not rely on `senderIsOwner`,
which requires separate owner allowlist configuration. Missing context, a second
sender, another channel, a different target, or a threaded/group route causes
zero Worker egress.

## Host preflight and STOP conditions

Before installation, run and save the non-secret report:

```bash
npm run preflight:host
```

It must report all three checks true: a Node version in
`>=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0`, OpenClaw exactly
`2026.7.1`, and a working `node:sqlite` in-memory query. Any mismatch is a
hard STOP.

OpenClaw 2026.7.1 filters optional skill-dispatch tools through the ordinary
model tool allowlist. Adding `jpmap_router` to that allowlist would violate the
project-before-model boundary. This package therefore uses the supported native
plugin command API, which is processed before agent invocation, and exposes no
tool contract. Runtime inspection must show command `jpmap` and an empty plugin
tool list. Do not restore the old skill or add any Atlas operation to a general
`tools.allow` list.

## Deferred Lightsail install

After T-03 is ready, build and transfer the resulting package archive through
the approved operator channel. Then, on the OpenClaw host:

1. Run the host preflight and stop unless every check passes.
2. Install the pinned local archive with
   `openclaw plugins install npm-pack:<reviewed-package.tgz>`.
3. Explicitly enable plugin `japan-atlas-jpmap` only for the Atlas workspace;
   do not grant shell, GitHub, Cloudflare management, D1/R2, write,
   maintenance, or reset tools.
4. Restart the Gateway. Verify runtime inspection reports command `jpmap`, an
   empty plugin tool list, and no Atlas operation in the model tool catalog.
5. From the owner WeChat DM, invoke a mocked
   `/jpmap nearby <manual address or area>`; verify second sender, group,
   ordinary model, and URL-shaped location probes have zero Worker egress.
6. Save the pinned OpenClaw version, Node version, SQLite check, plugin archive
   digest, configuration names, and zero-model trace without secret values.

Any missing configuration or trusted identity context, non-HTTPS endpoint,
timeout, rejected HTTP response, oversized response, malformed reply, or URL
location returns a fixed error and does not expose internal details.
