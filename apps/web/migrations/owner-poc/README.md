# Database migrations

Apply in order with `wrangler d1 migrations apply DB`. The chain is append-only: never edit or remove an applied file, because existing databases record them by name.

The application uses the catalog tables (`atlas_items`, overrides, tombstones, review candidates, snapshots, place identities and the catalog revision), personal data (`place_assessments`, `visits`, `visit_media`, `atlas_google_rating_references`), `owner_agent_settings`, the Add tables (`catalog_intake_*`, including the Nominatim cache and rate gate) and provider quotas (`agent_provider_usage*`). Other tables (import jobs, maintenance, the preview build's agent gateway and mutation receipts) are no longer read; they are kept so existing databases and rollbacks stay valid.
