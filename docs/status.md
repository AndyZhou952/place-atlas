# Status

Version 0.2 narrows the project to restaurants in Japan and reorganizes the code; the Add and Recommend agent harness is carried over unchanged.

## Implemented

- Map, Table and Journal views; filters by visit status, favorites, cuisine and prefecture; sorting by added date, score, ratings and last visit.
- Owner login; ratings, favorites, visited state, comments and title/description edits.
- Visits with notes, photos and videos, captions and a photo viewer; retry-safe uploads.
- Add: Google Maps–verified match (or Tabelog search / pasted listing), Nominatim coordinates, research agent with sourced Tabelog score, reservation rule, hours and links, editable preview, duplicate detection and confirm-once publication.
- Recommend from saved restaurants with clarifying questions, straight-line distance and optional walking/transit evidence from the route sidecar.
- Owner-only Google ratings; external Add Agent API with a dedicated Bearer token.
- Reads all records written by 0.1 without migration.

## Not included

- Events, architecture and restaurants outside Japan (existing event/architecture records are kept but hidden).
- In-browser (WebMCP) agent tools.
- Recommend recognizes ramen, sushi, curry, yakitori, beef tongue and coffee as food terms; other cuisines are not filtered yet.
- Messaging/chat integrations and a native app.
