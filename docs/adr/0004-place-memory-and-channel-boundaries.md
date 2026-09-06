# ADR 0004: Place-level memory and channel boundaries

Status: accepted
Date: 2026-09-06

## Context

The first journal slice created one card and one rating for every visit. Repeat
visits therefore duplicated the place, created conflicting ratings, and caused
the fixed panel layout to compress entries. The intended daily interaction is
also WeChat-first, while the map is primarily for browsing and remembering.

## Decision

1. Store one nullable personal assessment per Atlas item.
2. Store repeatable visits separately; derive visit number and visited state.
3. Store media bytes in R2-compatible storage and captions/relations in D1.
4. Surface the consolidated assessment, visits, and media in the selected-place
   map detail rather than a permanent Journal destination.
5. Use WeChat/Agent as the primary write channel. Keep web writes as contextual
   fallbacks and retain the transitional screens only until Agent parity.
6. Keep acquisition review contextual: the Agent sends a deep link when visual
   evidence needs a larger screen.

## Consequences

- repeat visits no longer duplicate place identity or personal ratings;
- optional ratings work for museums, buildings, events, and unrated meals;
- recommendation filters can derive visited/unvisited consistently;
- the Agent and website need finer-grained APIs instead of one journal POST;
- image support requires D1 plus object storage and cannot be implemented as a
  browser-only preview feature;
- removing current navigation must wait until the Agent replacement works.

