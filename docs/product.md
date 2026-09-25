# Product scope

Japan Personal Atlas reduces the work required to remember places, record visits, and choose a saved place nearby. It is currently single-owner: anyone may view the public map, while only the authenticated Owner may change data.

## Add

The Owner enters a rough name, branch, neighborhood, or address. The application finds candidates, asks the Owner to resolve ambiguity, builds a structured preview, and confirms. A confirmed record must become visible on the map or in an actionable review queue; it must never disappear into an unreadable state.

Google Places currently supplies candidate identity. Durable address and coordinates are required for map and Nearby. Automated category, signature-dish, Tabelog/Google-rating, reservation, and source enrichment is the next increment, not a current production guarantee.

## Record

The Owner can mark a place liked or visited, set a personal score, write an overall note, and create dated visits with text and photos. Journal supports an optional caption per photo. The same data should eventually be editable from place detail without creating a second record model.

## Nearby

Nearby considers only verified places already saved in the Atlas. It resolves a typed location and ranks reachable saved places. The current implementation is deterministic; semantic interpretation of screenshots, vague intent, cuisine preferences, and reservation constraints is planned.

## Agent boundary

Exact `/jpmap` commands call deterministic application operations. A bounded model adapter can extract approved facts from trusted-relay evidence, but production research is not connected yet. Future semantic interpretation of vague input must return a validated structured proposal before any write. Browser and chat integrations must not fork business rules.

## PoC non-goals

- discovering arbitrary restaurants outside the saved collection during Nearby;
- multi-user editing or social features;
- unattended writes without an explicit confirmation policy;
- storing private photos, journal text, or credentials in public datasets.
