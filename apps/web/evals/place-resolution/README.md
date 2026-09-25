# Place-resolution benchmark v1

This package evaluates the first, deterministic part of Add: given the text a person supplied, should the system resolve one real restaurant branch, ask for clarification, or return no match?

It does not evaluate ratings, reservation rules, signature dishes, or long-form web research. Those fields change independently and need separate enrichment benchmarks. Keeping identity resolution separate makes failures actionable and prevents a correct restaurant match from hiding invented enrichment.

## Contents

- `place-resolution-gold.v1.json`: 39 independently curated cases and 12 reusable real-place identities.
- `place-resolution-gold.schema.json`: the portable JSON Schema for the gold dataset.
- `place-resolution-predictions.example.v1.json`: a perfect offline prediction fixture and an integration contract example.
- `place-resolution-predictions.schema.json`: the portable JSON Schema for resolver output.
- `score-place-resolution.mjs`: a dependency-free validator and scorer.
- `score-place-resolution.test.mjs`: offline tests, including a regression test that rejects arbitrary chain-branch selection.

The metadata, documentation, and runner output are English. Queries intentionally preserve Chinese, Japanese, English, and romanized user input because multilingual resolution is the behavior under test.

## Gold actions

- `resolve`: one branch is sufficiently identified. `identityId` and `branchId` are required.
- `clarify`: the query is real but cannot safely identify one branch. The product should ask a focused follow-up or show two to three relevant candidates.
- `no_match`: no supported identity was found. The product must not invent a place, address, rating, or provider identifier.

Brand-only input such as `鳥貴族` is deliberately `clarify`. A resolver that silently chooses one store fails even if the selected store exists. A `clarify` result is only complete when it either asks a focused question for the required hint or offers two to three ranked candidates with readable labels.

## Run locally or in CI

From `apps/web`:

```sh
node --test evals/place-resolution/score-place-resolution.test.mjs
node evals/place-resolution/score-place-resolution.mjs \
  evals/place-resolution/place-resolution-gold.v1.json \
  evals/place-resolution/place-resolution-predictions.example.v1.json
```

Both commands are fully offline. They do not invoke Google Maps, an LLM, a search engine, or any paid API. A production resolver should write a prediction file in the documented shape during a separately authorized live evaluation; CI should only score a checked-in fixture.

The scorer exits with status `0` when every gate passes, `1` when valid predictions miss a quality gate, and `2` for invalid input or usage.

## Metrics and initial gates

| Metric                     | Meaning                                                                |         Gate |
| -------------------------- | ---------------------------------------------------------------------- | -----------: |
| Overall accuracy           | Correct action, plus correct identity when resolving                   | at least 90% |
| Action accuracy            | Correct `resolve`, `clarify`, or `no_match` decision                   | at least 90% |
| Resolved identity accuracy | Correct identity among gold `resolve` cases                            | at least 90% |
| Top-3 target recall        | Gold identity appears in the selected result or first three candidates | at least 95% |
| Clarification accuracy     | Ambiguous and underspecified cases are not guessed                     | at least 95% |
| Clarification UX accuracy  | Clarification uses an accepted hint request or two to three candidates | at least 95% |
| No-match accuracy          | Curated negatives return no match                                      | at least 95% |
| Unsafe auto-resolve rate   | `clarify` or `no_match` cases incorrectly resolved                     |   exactly 0% |

The report also includes accuracy slices by input tag, such as `chinese`, `romanized`, `ambiguous-branch`, and `international`. The initial set is intentionally small enough for human review; percentage changes should be interpreted with the case counts.

## Curation notes

- Real identities were checked on 2026-09-25 against the source URL stored on each entity and case.
- Nine cases specifically cover one- or two-name short messages. Five distinctive exact names resolve; four generic names or chain brands require a focused location follow-up. Each short resolve case carries a curation note explaining why the bare name is sufficient at the checked date.
- Tabelog pages are used as identity evidence for several Japanese restaurants because they expose the canonical name, area, and address. The benchmark does not copy a rating or assume it is stable.
- Official store locators are used to prove branch ambiguity for Torikizoku, AFURI, Starbucks Japan, and Ichiran.
- Overseas cases use restaurant-owned pages where available. The Ho Lee Fook case uses the Michelin Guide because its current address is directly exposed there.
- Synthetic negative cases test hallucination resistance. Their Google Maps URLs are reproducible search links, not a claim that absence from one search proves universal nonexistence.
- A source changing or a restaurant moving is a reason to review the gold case, not to silently update expected output at runtime.

## Adding a case

1. Prefer an official restaurant page or official branch locator. Use a reputable directory only when the official source does not expose stable identity and branch information.
2. Record the exact source URL and the date it was checked.
3. Include enough branch context to justify `resolve`; otherwise use `clarify`.
4. Add the case to a prediction fixture and run the offline tests.
5. Keep volatile ratings and inferred reservation advice out of this dataset.

This v1 is a resolver contract, not a leaderboard. A future benchmark can add captured provider-response fixtures, screenshot inputs, enrichment provenance, and failure-recovery scenarios without changing the three core actions.
