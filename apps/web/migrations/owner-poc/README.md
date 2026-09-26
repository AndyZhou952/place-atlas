# Application database migrations

Apply this directory in order with Wrangler D1 migrations. Complete setup commands are in the root README.

The additive chain retains historical table names for compatibility with existing databases. Do not remove applied migrations while cleaning up integrations. Export an existing database before upgrades. Fresh databases can apply the chain directly; no export from another account is needed.

Historical migrations may initialize demonstration records. After migration, verify the catalog, authenticated writes, Add confirmation visibility, independent ratings, visits, and photo loading. Preserve newer user data during rollback.
