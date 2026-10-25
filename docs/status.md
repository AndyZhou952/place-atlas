# Status

Version 0.2 narrows the project to restaurants in Japan.

## Implemented

- Map, Table and Journal views; filters by visit status, favorites, cuisine and prefecture; sorting by added date, score, ratings and last visit.
- Owner login; ratings, favorites, visited state, comments and title/description edits.
- Visits with notes, photos and videos, captions and a photo viewer; retry-safe uploads.
- Add from Tabelog (search or pasted URL) with an editable preview, duplicate detection and model-extracted signature dishes.
- Recommend from saved restaurants with an optional geocoded starting point.
- Optional Google Places matching and Owner-only Google ratings.
- External Add API with a dedicated Bearer token.
- Reads all records written by 0.1 without migration.

## Not included

- Events, architecture and restaurants outside Japan (existing event/architecture records are kept but hidden).
- Verified walking or transit times (Recommend shows straight-line distance and a directions link).
- Messaging/chat integrations and a native app.
