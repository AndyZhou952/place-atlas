# T-18 real WeChat acceptance and OpenClaw 0.3.1 hotfix — 2026-09-24

## Owner evidence

The Owner supplied a real direct-message transcript and screenshot. No sender
identifier, credential, or private location was copied into this record.

- `/jpmap nearby 银座` reached the production Google route path, resolved
  Ginza, and returned the valid empty-Catalog result.
- `/jpmap add 東京タワー` returned one Google Maps candidate.
- On plugin 0.3.0, `/jpmap add select 1` returned the fixed Nearby-unavailable
  text instead of the Add preview.
- `/jpmap add cancel` succeeded and closed the active intake session. This is
  consistent with the request reaching the shared production session, but by
  itself does not prove whether select completed or failed inside the Worker.
- The Owner confirmed the Google key is restricted to Places API (New), the
  requested cost controls are configured, and a budget alert is active.

This closes real connector delivery for deterministic Nearby and the
dual-entry deployment/rollback gate. The reviewed 0.3.0 source and mock-timer
regression identified the Add-specific client deadline defect; the existing
Owner production select evidence and subsequent signed 0.3.1 host probe
separately verified the Worker select/persistence path.

## Root cause and reviewed correction

OpenClaw plugin 0.3.0 used one four-second deadline for every command. Add
select can perform Google Place Details, durable geocoding, D1 coordination,
and the bounded initial research phase, so a cold request can legitimately
outlive that read-oriented deadline. Every transport failure also used the
Nearby-specific fixed reply, which made an Add timeout look like a routing
error.

Plugin 0.3.1 keeps Nearby at four seconds, gives Add discover/confirm/cancel
the 30-second write-receipt budget, and gives Add select 45 seconds to cover
the 35-second initial-provider budget plus coordination headroom. Add transport
failures now use the Add-specific fixed reply. Mock-timer regression coverage,
build, lint, package inspection, GitHub CI, and independent Standards + Spec
review passed with zero findings.

## Lightsail rollout

- Local and remote package SHA-256 matched before installation.
- Host preflight passed for Node 26.7.0, OpenClaw 2026.7.1, and `node:sqlite`.
- Plugin inspection after Gateway restart reported version 0.3.1, command
  `jpmap`, capability mode `none`, and no model-selectable tool.
- The Gateway was active after restart.
- Owner-only 0.3.0 and 0.3.1 archives were retained for recovery; one-time
  probe files and the temporary extraction directory were removed.

The signed production-host hotfix probe used a public place and cancelled the
session without publishing a test item:

- Add discover: success in 1,895 ms;
- Add select: preview/clarification success in 1,485 ms;
- Add cancel: success in 897 ms.

An unrelated Nearby probe immediately after restart received the closed
`Address lookup is temporarily unavailable` outcome from the route provider;
it did not time out or expose private data. The Owner's preceding real WeChat
Nearby request had already completed successfully, so this transient provider
outcome does not reopen connector-delivery acceptance.

## Remaining acceptance

T-18 remains open only until the Owner repeats the real WeChat Add sequence on
plugin 0.3.1 and confirms that `add select 1` now returns a preview or explicit
clarification before cancelling. No further Google Console or deployment
configuration action is currently requested.
