# Database migrations

Apply in order with `wrangler d1 migrations apply DB`. The chain is append-only: never edit or remove an applied file, because existing databases record them by name.

Several tables (Add sessions, receipts, provider usage, maintenance) were used only by 0.1 and are no longer read. They are kept so existing databases and rollbacks stay valid. The application reads `atlas_items`, `atlas_item_overrides`, `atlas_item_tombstones`, `place_assessments`, `visits`, `visit_media`, `atlas_google_rating_references` and `owner_agent_settings`.
