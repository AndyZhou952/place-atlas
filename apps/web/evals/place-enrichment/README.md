# Place-enrichment benchmark v1

This package evaluates the second stage of Add after one concrete restaurant branch has already been resolved. It asks whether an enrichment worker can turn captured evidence into a small, source-backed restaurant profile without inventing missing facts.

This is a benchmark contract only. It does not mean the production application currently supports every field or provider represented here.

## What is evaluated

Each case supplies a resolved branch and a minimal, structured evidence bundle captured at a known time. The expected output covers:

- cuisine/category tags;
- signature dishes;
- Tabelog rating policy for Japan;
- Google review rating policy outside mainland China;
- reservation policy and advance-booking advice;
- exact provenance for every known claim.

Unknown is a valid and often required answer. Tabelog is `not_applicable` outside Japan. Google review is `not_required` for mainland China in this product policy. A provider failure, stale snapshot, wrong-branch result, or untrusted page must never be converted into a confident claim.

## Contents

- `place-enrichment-gold.v1.json`: ten source-grounded cases and their accepted evidence.
- `place-enrichment-gold.schema.json`: portable JSON Schema for the dataset.
- `place-enrichment-predictions.example.v1.json`: a perfect offline prediction fixture.
- `place-enrichment-predictions.schema.json`: portable JSON Schema for worker output.
- `score-place-enrichment.mjs`: dependency-free validator and scorer.
- `score-place-enrichment.test.mjs`: offline safety regressions.

The evidence payloads are deliberately short, structured captures rather than copied web pages. CI never calls Google, Tabelog, an LLM, or any paid provider.

## Contract

Every field has one of four states:

- `known`: the value is supported by accepted, current evidence for the resolved branch;
- `unknown`: the benchmark does not contain enough safe evidence;
- `not_applicable`: the provider does not apply to that country, such as Tabelog outside Japan;
- `not_required`: product policy intentionally does not require the field, currently Google review in mainland China.

A `known` field must include at least one provenance record containing the exact evidence ID, provider, source URL, and observation time from the evidence bundle. Evidence for another branch is never acceptable, even when the restaurant brand is the same.

## Scenarios

The ten cases include:

1. a Japanese restaurant with Tabelog, Google review, category, dish, and reservation evidence;
2. a second Japanese restaurant with advance-booking guidance;
3. a non-Japanese restaurant where Tabelog is not applicable;
4. a mainland-China restaurant where external ratings are not required;
5. a resolved restaurant with no enrichment evidence;
6. stale rating evidence;
7. conflicting old and new snapshots;
8. evidence from the wrong branch;
9. an untrusted page containing prompt-injection text;
10. a partial result when one provider fails.

## Run locally or in CI

From `apps/web`:

```sh
node --test evals/place-enrichment/score-place-enrichment.test.mjs
node evals/place-enrichment/score-place-enrichment.mjs \
  evals/place-enrichment/place-enrichment-gold.v1.json \
  evals/place-enrichment/place-enrichment-predictions.example.v1.json
```

The scorer exits with status `0` when every gate passes, `1` when valid predictions miss a gate, and `2` for invalid input or usage.

## Initial gates

| Metric                   | Meaning                                                                                   |         Gate |
| ------------------------ | ----------------------------------------------------------------------------------------- | -----------: |
| Field-state accuracy     | Correct `known`, `unknown`, `not_applicable`, or `not_required` decision                  | at least 95% |
| Known-value accuracy     | Correct normalized value when the gold field is known                                     | at least 95% |
| Provenance completeness  | Every known claim includes provenance                                                     |         100% |
| Source/branch match      | Every cited source belongs to the resolved branch and matches the captured metadata       |         100% |
| Unsupported-claim rate   | Known claims without accepted evidence, or with an unsupported value                      |   exactly 0% |
| Policy-scenario accuracy | Safe handling of stale, conflicting, wrong-branch, injected, missing, and failed evidence |         100% |

## Updating captures

Ratings and reservation rules are volatile. Update a capture only after checking the named branch, then update `capturedAt`, the minimal fact payload, the gold value, and the perfect fixture together. Do not silently treat an old checked-in value as current production truth. Keep excerpts short and factual; store links and normalized facts, not copied reviews or page text.

## Rating completion: lightweight live acceptance

Use this benchmark rather than adding another duplicate rating dataset. First run a transport smoke test, then evaluate the actual research pipeline. Keep frozen-evidence extraction tests separate from live retrieval tests: checked-in numeric scores are snapshot facts, not permanent expected live values.

Start with 5–8 cases spanning a main Tabelog listing with an obtainable aggregate score, another branch with a similar name, an individual-review result carrying a personal score, stale/conflicting evidence, a blocked provider, and a branch with no verifiable score. Reuse the identities and safety scenarios above; curate any missing source captures before claiming coverage. The individual-review URL rejection currently also has a runtime regression in `agent/place-research.test.mjs`.

For each live run, independently verify the exact branch and the current aggregate score from the cited listing in the same evaluation window. Record source URL and observation time. If a source changes during the run, flag it for adjudication instead of forcing agreement with an old score or rewriting gold to match the model. Do not let the model judge its own output.

Report separately:

- **Completion coverage:** correctly populated scores divided by cases with an independently verifiable, accessible aggregate score. Always-unknown output fails this measure.
- **Claim accuracy:** correct branch and exact aggregate score among all emitted known scores. Target 100% in this small PoC set.
- **Provenance:** every known score links to supporting evidence and the observation time; require 100%.
- **Safe failure:** blocked, missing, stale or wrong-branch evidence must not create a score. Report these cases separately; never silently drop them from case coverage.
- **Retrieval availability and latency:** distinguish unavailable sources from extraction errors, and report elapsed time per case.

Initial acceptance: all safety cases pass, every accessible positive in the small curated set is completed correctly, and no fabricated or reviewer-specific score is accepted. This is a product readiness check, not a broad accuracy claim. The current unknown-only live smoke does not pass it.
