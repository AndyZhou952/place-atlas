# Complete Add extraction evaluation — 2026-09-26

## Outcome

### Follow-up: reservation correction

The v3 extraction prompt was rerun against the unchanged ten-case dataset at `2026-09-26T01:35:19.583Z`. All 130 field states and 88 known values passed automated checks, with zero unsupported known claims. The prompt hash is `35083842bf217eb5aa7cdef2bed37b64d89c1554596896c79f2dd738662de675`. This remains a frozen-evidence extraction result, not name-resolution or deployed Add acceptance; summary semantics still need manual review.

The earlier Yotsuya reservation claim was not actually established by its synthetic `reservationNotListed` evidence. Separately, the live [restaurant listing](https://tabelog.com/tokyo/A1309/A130902/13131643/) explicitly states that reservations are not accepted. The source reader now captures this policy as `not_reservable`, without claiming immediate seating or a queue time. Production rejects a known reservation object containing only `not_stated` values.

The research-to-preview-to-publication implementation now carries sourced identity, coordinates, categories, dishes, official/booking links and optional Google rating. Descriptions are composed from validated categories, area and dishes rather than accepting unconstrained model prose. Direct development-host research checks returned useful profiles for Yotsuya Takeda and Tokyo Mentsudan; neither check wrote a restaurant. Deployment and owner-confirmed browser persistence remain pending.

### Earlier baseline (retained for comparison)

DeepSeek Flash returned valid structured results for all ten cases. The suite did **not** pass: one reservation claim incorrectly had `state: known` with all values `not_stated`, although the supplied evidence established no reservation policy. No database writes or deployment occurred.

| Measure                         | Result                    |
| ------------------------------- | ------------------------- |
| Completed model calls           | 10/10                     |
| Correct field states            | 129/130 (99.23%)          |
| Correct known gold values       | 88/88                     |
| Claims with matching provenance | 100%                      |
| Unsupported known claims        | 1/89 (1.12%; required: 0) |
| Safety-scenario checks          | 6/6                       |
| Per-case latency                | 1.90–3.27 seconds         |
| Total tokens in this final run  | 24,852                    |

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

### Cloudflare browser findings

Real Chromium checks found and corrected an edge-runtime incompatibility: Workers rejects `redirect: error` before sending the request. Manual redirects plus non-success rejection now preserve the no-redirect security boundary. A local workerd probe reproduced the error; the deployed DeepSeek connection check and encrypted settings save subsequently returned 200.

Japanese no-key research now uses Yahoo Japan because DuckDuckGo intermittently blocked the Worker. The selected Tokyo Mentsudan branch was found by Google, and search found its Tabelog listing, but the listing returned HTTP 403 from Cloudflare. Research produced no complete location/rating, so no confirm or restaurant write was attempted. This is a failed production Add acceptance, not a passing enrichment result. Temporary diagnostics contained only counts/status/booleans and were removed after diagnosis. A permitted reliable source-access solution still needs investigation; no challenge bypass or invented fallback data was added.

The full offline suite passed 685 tests before the final source-routing change; the changed search/research/discovery slice subsequently passed 35 tests. Type checking and production builds passed. Neither replaces the outstanding Add-to-map browser gate.

- Reservation unknown-state handling and complete-profile propagation now have regression coverage; verify the deployed path separately.
- Run the actual name-resolution pipeline against `place-resolution-gold.v1.json`, including short/ambiguous inputs and branch follow-ups.
- Evaluate live source retrieval and score freshness separately from frozen-evidence extraction.
- Review generated summaries for factual support, localization and useful descriptions; then test confirmed Add-to-map end to end on Cloudflare.
