# Add evaluation

Add succeeds when the correct restaurant becomes visible after confirmation. A plausible preview alone is insufficient.

`apps/web/evals/place-resolution` tests multilingual, romanized, partial, short, ambiguous-chain, and no-match queries. A chain-only hint requires a focused location question or two to three branch choices. Short input does not imply a unique restaurant.

`apps/web/evals/place-enrichment` tests categories, dishes, ratings, reservations, and provenance. Some fields describe target behavior rather than current production support. Missing, stale, conflicting, wrong-branch, or unavailable evidence must not become invented facts.

The complete Add revision (`place-enrichment-complete-add.v2.2`, retained in the existing dataset files) has ten cases and 13 field groups: identity name/branch/area/address/coordinates, categories, summary, signature dishes, two ratings, official website, booking link and reservation rules. Report per-field failures, not only aggregate accuracy. Summary fact references are scored automatically but the prose needs semantic review. Coordinate comparison allows 0.0002 degrees per axis (roughly 30 metres diagonally around Tokyo). Most records are explicitly synthetic controls; Yotsuya's identity, coordinates, categories and aggregate score were independently checked on its Tabelog main listing. Synthetic Google ratings, dishes, and booking rules must not be presented as real current restaurant data.

`evals/run-add-enrichment.mjs` provides a read-only real-model/frozen-evidence extraction experiment. It sends only the selected branch, evidence and generic output contract, never gold answers or curation notes, and masks scenario-bearing case IDs. The experiment has a separate full-profile prompt; the production research adapter still returns only Tabelog and a limited reservation structure. An extraction score is not a production workflow score. Model calls require local server-side environment credentials. The completed Flash extraction run and remaining failure are recorded in [the evaluation report](add-evaluation-2026-09-26.md). The root README includes the runnable command. Continue to evaluate name resolution separately against `place-resolution-gold.v1.json`.

Its lightweight `rating-completion-benchmark.v1.json` narrows rating acceptance to eight cases, with a separate scorer and explicit live-capture versus synthetic-control metadata. Three listing observations have been checked directly; real model predictions remain pending. The runtime must not receive gold values or curation notes. Recheck current scores before each later live run.

From `apps/web`, run `npm run test:evals`, `npm run eval:place-resolution`, and `npm run eval:place-enrichment`. Example prediction files test the scorers, not live model quality. Generate separate predictions through the actual pipeline for live evaluation; record model configuration, latency, source failures, and available cost information without committing secrets.

Unsafe branch selection and unsupported claims must remain zero. Dataset READMEs define other numerical gates. Integration checks additionally prove idempotent confirmation, visibility after refresh, independent rating persistence, and retry without repeating supplied details.

## Resolution versus enrichment

Every real resolution evaluation must score predictions against `apps/web/evals/place-resolution/place-resolution-gold.v1.json`. Pass only case IDs, user queries and allowed user context to the system under test, never gold actions, identity answers, source URLs or curation notes. Match returned identities to gold only in the evaluator. Preserve clarification cases instead of forcing a branch match. Validate all 39 case IDs, report per-case failures and aggregate gates, and record missing/error cases as failures rather than dropping them.

The current research Agent accepts an already selected restaurant. Its output cannot be scored as a resolution prediction; a resolution runner still needs to be connected to the actual discovery/semantic pipeline. Enrichment must be scored separately against its own gold dataset. Perfect example predictions only test scoring code.

## Latest limited live observation

On 2026-09-26, development-host DeepSeek (`deepseek-chat`) completed two DuckDuckGo searches for Aldebaran in about 4 seconds. Both Tabelog and reservation fields remained unknown. The tool loop and no-key transport worked; enrichment did not pass, no database write occurred, and Cloudflare was not tested. This predates the source-aware prompt revision. The redundant one-off JSON trace was removed; this summary preserves its conclusion without treating it as a benchmark result.

At 00:50 UTC on the same date, the bounded direct Tabelog listing reader retrieved branch identity and aggregate scores for Yotsuya Takeda (3.71), Kabuto (4.42), and Tokyo Mentsudan (3.54) in approximately 0.7–1.1 seconds per page from the development host. Cached browser research showed 3.55 for Mentsudan, illustrating why live evaluation must use a freshly adjudicated capture rather than a permanent expected score. These checks bypassed search/model calls, performed no writes, and do not establish full Add quality or Cloudflare availability. A subsequent Flash live research smoke and full-profile extraction run are recorded in [the evaluation report](add-evaluation-2026-09-26.md); neither establishes full Add acceptance.

## Nearby evaluation

`apps/web/evals/nearby` contains the initial 14-case synthetic policy suite and scorer. It establishes saved-only recommendation and route/uncertainty boundaries before Agent integration. It does not yet evaluate real location interpretation, screenshot understanding or live provider accuracy. Those remain open in the core PoC checklist. `npm run test:evals` runs all three scorer test suites.

## Artifact retention

Keep curated gold datasets, JSON schemas, fixtures required by tests, migrations and configuration. Store temporary predictions, provider captures and detailed run traces under ignored `evals/runs/`; do not commit credentials. Promote only a reviewed, reproducible benchmark report with dataset/model/prompt versions, case coverage, failures, timing and test environment. Do not delete JSON merely because of its extension.
