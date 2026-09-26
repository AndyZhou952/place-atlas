# Add evaluation

Add succeeds when the correct restaurant becomes visible after confirmation. A plausible preview alone is insufficient.

`apps/web/evals/place-resolution` tests multilingual, romanized, partial, short, ambiguous-chain, and no-match queries. A chain-only hint requires a focused location question or two to three branch choices. Short input does not imply a unique restaurant.

`apps/web/evals/place-enrichment` tests categories, dishes, ratings, reservations, and provenance. Some fields describe target behavior rather than current production support. Missing, stale, conflicting, wrong-branch, or unavailable evidence must not become invented facts.

From `apps/web`, run `npm run test:evals`, `npm run eval:place-resolution`, and `npm run eval:place-enrichment`. Example prediction files test the scorers, not live model quality. Generate separate predictions through the actual pipeline for live evaluation; record model configuration, latency, source failures, and available cost information without committing secrets.

Unsafe branch selection and unsupported claims must remain zero. Dataset READMEs define other numerical gates. Integration checks additionally prove idempotent confirmation, visibility after refresh, independent rating persistence, and retry without repeating supplied details.
