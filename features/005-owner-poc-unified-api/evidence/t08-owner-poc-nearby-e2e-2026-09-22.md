# T-08 owner-poc Nearby E2E evidence

- Date: 2026-09-22
- Status: pending independent review; live channel gate remains incomplete
- Scope: deterministic `/jpmap nearby` only; no Add/CatalogIntake, composition, operation-catalog, migration, deploy, or endpoint-switch changes

## Local vertical evidence

The T-08 contract traverses the native OpenClaw command handler, signed HTTP request, Agent HTTP adapter, HMAC/owner/channel/scope/nonce gateway, `ProjectCommandRouter`, `AtlasApplication nearby.recommend`, and the closed WeChat presenter. Only the external Nearby provider is replaced by a deterministic fixture.

- Red: the new contract initially failed because the T-08 fixture did not exist.
- Green: the new contract passes 3/3.
- Owner DM accepts `银座`, `銀座`, and `ginza`, records three `nearby.recommend/success` audits, and invokes the model zero times.
- Second-account and group contexts fail before Worker egress with zero provider/model/audit calls.
- Wrong scope returns `403 forbidden`; nonce reuse returns `401 unauthorized`; both produce the expected sanitized audit outcomes without duplicate provider execution.
- Existing command/gateway/Nearby integration tests pass 16/16; pinned OpenClaw `0.2.0` tests pass 11/11.
- Focused format/lint and Web typecheck passed during the T-08 run; the two concurrent T-12 lint diagnostics noted at that time were subsequently resolved and repository-wide lint now passes.

## Read-only remote observations

- Current owner-poc and old read-only fixture deployments are listed; all expected owner-poc secret names exist. No secret value was read or printed.
- Owner-poc audit aggregates contain four historical `agent.nearby/success` rows and one `unknown/unauthorized` row. They predate `nearby.recommend` and are not T-08 completion evidence.
- The old rollback fixture remains reachable with gateway tables intact: 4 audit, 3 nonce, and 3 receipt rows.
- No Worker was deployed, no endpoint switched, and neither D1 was mutated.

## Remaining live blocker

The configured Lightsail SSH endpoint refused the connection. Current real-WeChat owner/second-account/group probes, installed-runtime zero-model evidence, and matching current `nearby.recommend` Worker audits could not be captured. T-08 remains unchecked and pending independent review; T-11 remains responsible for permanent switching and rollback rehearsal.

### 2026-09-22 SSH path diagnostic

- Local alias `test` resolves to user `root` at `47.79.124.13:31484`; its known-host entry exists, but the SSH config was last modified on 2026-07-18.
- A public allocation lookup identifies `47.79.124.13` as Alibaba Cloud (`AS45102`) in Singapore, not AWS Lightsail. The alias is therefore not a verifiable path to the Lightsail runtime described by the feature artifacts.
- TCP/SSH to the configured custom port is immediately refused. Standard port 22 times out. Both failures occur before host-key or user-key authentication, so neither username nor private-key validity explains this blocker.
- This environment has no AWS CLI, AWS profile directory, or AWS environment credentials, so the actual Lightsail instance state, static IP, and firewall rules could not be inspected independently.
- Required user action: provide or update the current Lightsail hostname/static IP and SSH port (or make read-only Lightsail account metadata available). Then verify the instance is running and that its Lightsail networking rule admits TCP SSH on that exact port before repeating the live T-08 probes. No AWS, firewall, host, deploy, endpoint, or repository configuration was changed during this diagnostic.
