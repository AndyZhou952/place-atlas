# Status

**0.1.0** — restaurants in Japan. [Features](features.md) describes each feature; this page keeps the scope and the plan.

## Implemented

- Map, Table and Journal views with search, filters (visited, favorites, cuisine, prefecture) and sorting (added, scores, last visit, name).
- Owner login; personal 0–10 scores, favorites, visited state, comments, title/description edits and deletion.
- Visits with notes, scores, photos and videos, captions and a photo viewer; uploads are retry-safe and leave nothing behind when they fail.
- Add: Google Maps–checked match (or Tabelog search / a pasted listing), Nominatim coordinates, a research agent that keeps only sourced facts about the selected branch (Tabelog score, reservation rule, hours, categories, dishes, links), an editable preview, duplicate detection and confirm-once publication.
- Recommend from saved restaurants by dish or cuisine, origin, walking time, visited preference and walk-in, with clarifying questions and walking times from the optional route sidecar.
- Owner-only Google ratings; the external Add Agent API with its own Bearer token.

## Not included

- Places outside Japan.
- Train and driving times; conditions on scores in Recommend.
- Hosting outside Cloudflare.

## Next version

- **Recommend with conditions on your data**: an agent translates requests such as *a place I have never visited near Ginza* or *ramen with a score above 3.5* (usually the Tabelog score in Japan) into explicit conditions; code checks each condition against the saved catalog before anything is returned. A benchmark covers these combinations on a realistic catalog.
- **Chat channels**: a bot in any chat app that supports bots (for example Telegram, WhatsApp, LINE, Slack or Discord) connected to the atlas, to add restaurants, get recommendations and record visits with photos from a chat app.
