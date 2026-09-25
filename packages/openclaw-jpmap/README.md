# Japan Atlas OpenClaw PoC client

This package is the closed OpenClaw 2026.7.1 client for the canonical
`/jpmap nearby <manual address or area>` command and deterministic Add flow:

```text
/jpmap add <restaurant name or address>
/jpmap add select <1-3>
/jpmap add confirm
/jpmap add cancel
```

It registers one native plugin command that OpenClaw executes before
agent/model invocation. It does not register or ship any model-selectable tool
or skill. The client maps only these exact commands to the server manifest's
Nearby operation and four Catalog Intake operations.

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

Supply these variables to the OpenClaw Gateway process through either a
service-account-owned `0600` environment file for the reviewed user-level
systemd deployment, a root-owned service environment file for a system-level
deployment, or an equivalent secret manager:

```text
JPMAP_AGENT_ENDPOINT=https://<isolated-worker-host>/api/agent/v1/tools
JPMAP_AGENT_KEY_ID=<owner-key-id>
JPMAP_AGENT_HMAC_SECRET=<random-hmac-secret>
JPMAP_OWNER_ACTOR_ID=<owner-actor-id>
JPMAP_OWNER_CONVERSATION_ID=<owner-direct-message-id>
```

Do not place values in this repository, `openclaw.json`, shell history, logs,
or chat. The endpoint must be HTTPS and contain no URL credentials, query, or
fragment. Provision the matching Worker key for project `jpmap`, owner
channel `openclaw-weixin`, conversation type `direct`, and only
`atlas:nearby:read` plus `atlas:intake:write`. The server remains the authority
for scope checks, state transitions, preview confirmation, and publication.

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
   do not grant shell, GitHub, Cloudflare management, direct D1/R2,
   maintenance, reset, or any write operation outside the four Catalog Intake
   operations.
4. Restart the Gateway. Verify runtime inspection reports command `jpmap`, an
   empty plugin tool list, and no Atlas operation in the model tool catalog.
5. From the owner WeChat DM, invoke a mocked
   `/jpmap nearby <manual address or area>` and the complete Add flow; verify
   second sender, group, wrong scope, ordinary model, invalid command, and
   URL-shaped location probes have zero unauthorized Worker egress.
6. Save the pinned OpenClaw version, Node version, SQLite check, plugin archive
   digest, configuration names, and zero-model trace without secret values.

Any missing configuration or trusted identity context, non-HTTPS endpoint,
timeout, rejected HTTP response, oversized response, malformed reply, or URL
location returns a fixed error and does not expose internal details.

Runtime deadlines are operation-aware: Nearby retains its 4-second read
deadline; Add discover, confirm, and cancel use the 30-second write-receipt
budget; Add select uses 45 seconds so its bounded 35-second initial provider
phase still has coordination headroom. The test-only `timeoutMs` option
explicitly overrides these defaults.

## Atomic Agent endpoint/key switch and rollback

The host-side switch helper changes only the OpenClaw service environment
file. It does not install a package, restart a service, call the Worker, or
change the Web route. Run it only after the release and Worker credentials have
passed their separate preflight.

The current environment file must already contain exactly one of each of the
five reviewed `JPMAP_*` names shown above and no other `JPMAP_*` name. The
helper preserves the current Owner actor and conversation values; only the
endpoint, key ID, and HMAC secret are replaced. Existing unrelated environment
assignments and comments are preserved.

Place each new value in its own protected regular file. Values are never CLI
arguments and therefore do not enter shell history or the process list. The
endpoint must be HTTPS with the exact `/api/agent/v1/tools` path and no URL
credentials, query, or fragment. The key ID, HMAC secret, and existing Owner
IDs must be bounded single-line values without control characters. All input
files and the current environment must be owner-only; symbolic links and hard
links are rejected.

```bash
chmod 600 /controlled/new-endpoint /controlled/new-key-id /controlled/new-hmac
node scripts/agent-target-switch.mjs switch \
  --environment-file /controlled/openclaw.env \
  --backup-file /controlled/openclaw.env.jpmap-rollback-001 \
  --endpoint-file /controlled/new-endpoint \
  --key-id-file /controlled/new-key-id \
  --hmac-secret-file /controlled/new-hmac
```

Use absolute paths. The backup must be in the same directory as the service
environment and must not already exist. The helper validates every input before
writing, creates a protected `0600` rollback snapshot, then writes a `0600`
same-directory temporary file and atomically renames it over the environment.
It retains the environment file's uid/gid. A service-account-owned `0600` file
implements the service-identity-only secret policy for this user-level systemd
deployment. Prefer running the command as that service account. When an
administrator runs it as root, the helper still preserves the service account
ownership; any other caller is rejected.

Successful output contains only the status, the five configuration names, and
SHA-256 digests. It never prints a value. Record only those non-secret fields
in rollout evidence. A failure before the atomic rename prints only a closed
error code and leaves the live environment unchanged. If the rename commits but
the directory durability sync cannot be confirmed, the command succeeds with
`switched_durability_unconfirmed` (or
`rolled_back_durability_unconfirmed`). Treat that status as already switched:
inspect the live file owner, mode, five names, and reported digest immediately;
do not blindly retry. If the rename itself fails after the rollback snapshot was
safely created, keep that snapshot for operator recovery.

The helper deliberately does not reload or restart OpenClaw. After a successful
switch, separately inspect the file owner/mode and configuration-name presence,
then perform the reviewed user-level Gateway restart and signed positive and
negative probes. Do not copy values into evidence.

Rollback replaces only the Agent environment and leaves the Web entry point
unchanged:

```bash
node scripts/agent-target-switch.mjs rollback \
  --environment-file /controlled/openclaw.env \
  --backup-file /controlled/openclaw.env.jpmap-rollback-001
```

Rollback validates both files, preserves service ownership, performs the same
atomic replacement, and does not consume or rewrite the snapshot. Restart and
probe the Gateway separately. To restore the green target after a rollback
rehearsal, run `switch` again with the same protected green input files and a
new, non-existing backup filename; never overwrite either rollback snapshot.
