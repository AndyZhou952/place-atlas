# Place Atlas development status

Place Atlas is a self-hosted atlas for restaurants, architecture and events across regions. The released 0.1.0 implementation focuses on restaurant workflows. [Architecture](architecture.md) describes system and release boundaries; README covers setup and use. Detailed incident reports, live benchmark results and Owner-specific acceptance evidence remain in chat.

## Implemented

- Published restaurant, architecture and event records can be browsed in Map and Table with search, filters, details and source links. Journal records restaurant visits.
- Restaurant Add supports discovery, exact-branch selection, sourced research, editable review and Owner-confirmed publication. Missing facts remain unknown. Location checks, session versions, duplicate detection and replay-safe writes protect publication.
- Source readers validate branch identity, aggregate ratings, cuisine, dishes and reservation policy. Bounded official/booking reads preserve independently verified facts when the model or another provider fails.
- Personal ratings, Tabelog ratings and eligible Google scores are independent. Google references are private, dated and saved or replaced explicitly; loading a new score does not replace them.
- Visits support dates, notes, photos/videos and captions. Editing or moving a Visit preserves its media; upload retries do not create another Visit. Restaurant-level assessments remain separate from Visit history.
- Recommend uses only verified saved restaurants, with clarification and canonical detail targets. Precise origins use straight-line distance by default; explicit walking requires fresh route evidence. Unsupported driving and image-based origins remain explicit limitations.
- One Owner controls each independent deployment; anonymous visitors can read published places and media. Cloudflare Workers, D1 and R2 hold the application, records and media. Provider credentials remain server-side.
- The external Add API exposes scoped discover/select/confirm/cancel operations over the same application coordinator. Browser tools use the website session. These foundations do not constitute a complete framework or chat integration.

## Post-release improvements

- Official websites and alternative booking destinations are verified independently from reservation-policy citations. Map and Table show plain policy labels, one Tabelog link and only distinct verified destinations. Booking timing is optional.
- Schedule readers use the exact Tabelog listing for Japan and the selected Google Maps place elsewhere. Sourced hours, regular closing policies and Owner corrections survive review, refresh, confirmation, storage and display. Calendar closures stay separate; missing fields remain unavailable.
- Initial loading waits for the actual saved catalog rather than displaying bundled demonstration records. Failed loads offer retry; subsequent refreshes retain the loaded data.
- Public repository regressions use compact generic cases for source identity, links, schedules and persistence. Owner-specific research snapshots, generated reports, superseded evaluators and completed repair tooling are excluded.

## Planned

- Architecture/event intake: entity-specific source validation, review behavior and complete user journeys. Existing browsable records do not establish equivalent automatic intake.
- International restaurants: broader live validation of regional identity, ratings, booking, schedules, classification and cross-language duplicates. Overseas paths and controlled cases do not prove worldwide reliability.
- Agent frameworks and messaging channels: portable application operations and validated adapters for frameworks such as Hermes, OpenClaw and Pi, and channels such as WhatsApp, WeChat, Telegram and LINE. No packaged framework or messaging adapter is shipped.
- Conversational Visits/media: scoped Owner authentication, separate conversation identities, clarification, confirmation and interrupted-upload recovery. Manual upload/display exists; automatic image interpretation is separate work.
- iOS: a client using the same application operations.
- Bulk Google references: explicit save/replacement with per-record outcomes and safe partial retries. Per-restaurant references already exist.
- Ongoing quality: source availability and broader branch disambiguation, independently evaluated image inputs, and live compatibility checks for every advertised integration.
