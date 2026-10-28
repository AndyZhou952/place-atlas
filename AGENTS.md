# Repository working rules

## Deploying for the Owner

- Follow "Deploy step by step" in README.md. The Owner creates the Cloudflare account, enables R2 and runs `npx wrangler login`; do everything else.
- Keep deployment settings in the ignored `wrangler.local.jsonc` (or an existing `wrangler.owner-poc.local.jsonc`). Never commit a database ID, account ID, password, key or token, and never print secret values.
- Ask the Owner for the Owner password and provider keys and pipe them to `wrangler secret put`; generate `ATLAS_OWNER_SESSION_SECRET` yourself.

## Public content

- Keep chat transcripts, progress reports, incident narratives and restaurant-specific research or benchmark results in chat, not public repository documentation.
- Never commit an Owner catalog export, saved item IDs, personal records, production database/bucket identifiers, credentials or raw live evaluation responses. Temporary private evidence belongs in ignored local output directories.
- Use README for a brief overview, screenshots and setup, `docs/features.md` for detailed feature behavior, `docs/architecture.md` for boundaries and design, and `docs/status.md` for concise implemented/planned status and the roadmap. Do not add project reports or extra documents unless the user explicitly requests them. Existing evaluation READMEs should describe generic protocols, not named production incidents.
- Prefer synthetic, minimal fixtures for general behavior. Preserve multilingual input where it is the behavior under test; do not turn a conversation's restaurant examples into public fixtures or documentation.

- After a history rewrite, base further work on the cleaned branch. Rebase or cherry-pick unfinished changes; merging or pushing an old branch can restore deleted history.
- Before publication, audit current files and reachable Git history, release assets, issue/PR content and retained artifacts. Deleting a file from the current tree does not erase its earlier versions.

## Cleanup before a pull request is ready

- Inspect changed files and their references. Remove superseded benchmark versions, research batches, generated reports, unused helpers/runners and completed one-time repair tooling. Do not keep intermediate artifacts merely as an archive.
- Extend the existing workflow and evaluation entry point instead of introducing another parallel implementation. Keep distinct tests only when they exercise a different failure or boundary.
- Retain compact regression cases needed to protect runtime behavior. An offline oracle, a live provider run and a database/browser check are different evidence; do not claim one proves the others.
- Review additions over 1,000 lines: separate application code, tests and data, remove duplication, and explain the remaining size in chat. Line count is a review trigger, not permission to delete required behavior or hide data through compressed formatting.
- Check references after deletions and run the checks appropriate to the final change. Remove temporary task outputs before completion; do not touch unrelated ongoing work.
- Keep migrations and compatibility paths that existing saved data still use. Verify a path is unused before deleting it; cleanup must preserve Owner records and the application's supported upgrade behavior.
