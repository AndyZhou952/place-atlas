# Place Atlas release candidate

The 0.1.0rc1 release focuses on self-hosted restaurant collection and visits. README covers independent setup; [architecture](architecture.md) describes application boundaries.

## Implemented

- Map and Table browsing with search, filters, published source links and restaurant details.
- Owner-confirmed restaurant research with branch selection, editable previews, duplicate checks and replay-safe publication.
- Separate personal and external ratings, including private Google references saved explicitly.
- Visits with dates, notes, photos, videos and captions; anonymous access to published records and media.
- Recommendations from the saved collection, with clarification and optional walking-route evidence.
- Owner authentication, encrypted provider settings and independent Cloudflare Worker, D1 and R2 resources.
- Scoped external Add operations share the application coordinator with browser operations.

## Planned

Broader international source validation, architecture and event intake, agent framework and messaging adapters, conversational visits and media, an iOS client, and bulk Google reference saves.
