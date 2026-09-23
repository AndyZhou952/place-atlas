# Provider policy evidence

These versioned files are activation templates, not proof that a provider may be used.

A deployment may copy a template into runtime configuration only after every `activation.requiredEvidence` item is attached, a reviewer and review timestamp are recorded, every used field is explicitly `allow`, and `status` is changed to `active`. `pending` is denied exactly like `deny`.

Do not place API keys, account identifiers, billing exports containing private data, or supplier response bodies in this directory. Secrets belong only in Cloudflare Secrets. A provider agreement change creates a new dated policy version; it never edits an accepted version in place.

The Foursquare API field names do not inherit rights from the separately licensed Places OS dataset. In particular, `rating` remains unknown until the actual API agreement provides explicit evidence for the intended use.

## Code review round 1 remediation

The 2026-09-13 remediation was completed without activating a provider or making a real provider request.

- SSRF red: the focused gateway suite failed for hexadecimal IPv4-mapped IPv6 (`::ffff:7f00:1`), mixed public/private DNS answers, and non-unicast redirect targets.
- SSRF green: `node --experimental-strip-types --test product/provider-policy/provider-policy-gateway.test.mjs` passed 11/11. The gateway now uses `ipaddr.js@2.5.0`, converts IPv4-mapped IPv6 to IPv4 before transport, and permits only addresses classified as public `unicast` on every DNS resolution and redirect hop.
- Google scope red: the real versioned Google policy document rejected both route adapters because the document granted `routes.compute` while the adapters requested `routes.read`.
- Google scope green: the following suite passed 5/5 and exercises the real policy document through both adapters:

  ```sh
  node --experimental-strip-types --test adapters/providers/google-routes-policy.contract.test.mjs adapters/providers/google-walking-route-provider.contract.test.mjs adapters/providers/google-transit-route-provider.contract.test.mjs
  ```
