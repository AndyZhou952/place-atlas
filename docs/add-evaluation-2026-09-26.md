# Complete Add extraction evaluation — 2026-09-26

## Outcome

DeepSeek Flash returned valid structured results for all ten cases. The suite did **not** pass: one reservation claim incorrectly had `state: known` with all values `not_stated`, although the supplied evidence established no reservation policy. No database writes or deployment occurred.

| Measure | Result |
| --- | --- |
| Completed model calls | 10/10 |
| Correct field states | 129/130 (99.23%) |
| Correct known gold values | 88/88 |
| Claims with matching provenance | 100% |
| Unsupported known claims | 1/89 (1.12%; required: 0) |
| Safety-scenario checks | 6/6 |
| Per-case latency | 1.90–3.27 seconds |
| Total tokens in this final run | 24,852 |

All field groups other than reservation passed automated checks: name, branch, area, address, coordinates, categories, summary fact references, signature dishes, Tabelog, optional Google rating, official website and booking link. Summary prose is not semantically graded by the automatic scorer; manual review remains required. Ten cases are a smoke benchmark, not a reliability estimate for arbitrary restaurant inputs.

## Scope and reproducibility

- Dataset: `place-enrichment-complete-add.v2.2`, existing `apps/web/evals/place-enrichment/place-enrichment-gold.v1.json` filename retained.
- Dataset SHA-256: `ff73189f5cfb77fd07b93c9a4e3df6c0a0569efbcfbcce32147597a7d809a96b` (parsed JSON serialized with `JSON.stringify`).
- Prompt: `add-full-profile-extraction-eval-v2` in `evals/run-add-enrichment.mjs`.
- Prompt/contract SHA-256: `0d677e828be213dd2856475edc944defacd576597f1ba6a86d51311f0bbb57e0`.
- Model: `deepseek-flash` at `api.deepseek.com`; `reasoning_effort: none`, temperature 0, maximum 4,500 output tokens, 60-second request timeout.
- Finished: `2026-09-26T01:22:03.486Z`, development host, not Cloudflare.
- Command from `apps/web`: `node --experimental-strip-types --env-file=.env evals/run-add-enrichment.mjs evals/runs/new-run.json`.
- Raw output is local and ignored: `evals/runs/deepseek-flash-complete-add-v2.2-2026-09-26.json`. Use a new output filename on reruns.

The model receives a selected branch and frozen evidence, not gold answers. This uses a separate full-profile extraction prompt, not the production Add prompt. Most evidence is explicitly synthetic; only the indicated Yotsuya listing identity, coordinates, categories and score were independently captured. Synthetic dishes, Google ratings and booking rules are test controls, not live restaurant facts.

## Diagnostic runs and corrections

An initial provider-default-thinking run exhausted the 4,500-token output allowance without returning JSON and was stopped. Non-thinking diagnostic runs revealed fixture/scorer defects: summary references were too strict, overseas coordinates were inconsistent with their countries, known links lacked payload support, and redundant identity evidence caused false citation failures. These were corrected before the v2.2 baseline; verified Yotsuya facts were separated from synthetic menu evidence. Earlier runs are not acceptance baselines. Token totals above exclude these diagnostics and the separate live smoke.

## Separate production research smoke

The existing production research adapter completed two model calls and bounded search/source reads for Yotsuya Takeda in approximately 5.97 seconds. It returned Tabelog 3.71 with the correct listing URL; reservation remained unknown. No restaurant was written. This verifies one narrow live path, not full Add enrichment or deployment.

## Remaining work

- Fix and regression-test reservation unknown-state handling without weakening the gold requirement.
- Connect the complete profile contract to production search, extraction, preview, confirmed persistence and card rendering. The current research adapter exposes Tabelog and limited reservation output; the extraction experiment does not add production support for the other fields.
- Run the actual name-resolution pipeline against `place-resolution-gold.v1.json`, including short/ambiguous inputs and branch follow-ups.
- Evaluate live source retrieval and score freshness separately from frozen-evidence extraction.
- Review generated summaries for factual support, localization and useful descriptions; then test confirmed Add-to-map end to end on Cloudflare.
