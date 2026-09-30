# Recommend evaluation

The 92-case model-only benchmark was frozen before the formal baseline; later application and decision extensions are tracked separately. It evaluates the proposed **Recommend** journey over saved restaurants. The existing `../nearby/` suites remain as retention gates; their 14 policy and 10 station cases are included in the model baseline without changing their labels.

## Gates and evidence

| Layer                             | Dataset                  |   Cases | Verifier                 | Evidence boundary                                                                                                     |
| --------------------------------- | ------------------------ | ------: | ------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Short request interpretation      | `intent-gold.v1.json`    |      34 | `score-intent.mjs`       | Synthetic text and origin options; no geocoding claim                                                                 |
| Clarification continuation        | `dialogue-gold.v1.json`  |       8 | `score-intent.mjs`       | Ordered dialogue with a synthetic option set; no live conversation claim                                              |
| Saved catalog and route decision  | `decision-gold.v1.json`  |      26 | `score-decision.mjs`     | Frozen catalog and tool observations; no live route claim                                                             |
| Resolved-origin proximity policy  | `decision-spatial.json`  |       6 | `score-decision.mjs`     | Current policy: straight-line distance by default; explicit walking remains strict                                    |
| Proximity intent policy           | `intent-proximity.json`  |       7 | Production normalizer    | Model output cannot invent a mode, origin or walking limit; driving fails honestly                                    |
| Saved entry-rule extension        | `decision-entry.v1.json` |       4 | `score-decision.mjs`     | Added after the frozen baseline; separates sourced walk-in rules, unknown rules and advance booking                   |
| Entry wording extension           | `intent-entry.v1.json`   |       5 | `score-entry-intent.mjs` | Added after the frozen baseline; distinguishes walk-in entry from walking duration with adversarial model predictions |
| API and browser journey           | `contract-gold.v1.json`  |      14 | `score-contract.mjs`     | Requires a browser/API trace from the application; oracle tests only validate the scorer                              |
| Retained policy and station cases | `../nearby/`             | 14 + 10 | Existing scorers         | Historical synthetic policy and officially checked station identity cases                                             |

The original 92 model-only cases are intentionally separate from the 14 application traces. That frozen historical set contains earlier transit-time scenarios; retain it for comparison, but exclude those scenarios from the current PoC release acceptance rate. The current application contract and proximity extensions require default straight-line distance or evidence-backed walking only. The later 6-case proximity decision, 7-case proximity intent, 4-case entry-decision and 5-case entry-wording extensions and 15+4 paraphrase set are reported separately from that frozen baseline. The entry-wording and proximity-intent extensions run the production deterministic guard against frozen, sometimes incorrect model predictions; they do not measure fresh DeepSeek performance. The model baseline cannot prove that the production app called its tools, preserved an answer through the UI, or opened the right restaurant detail. Those require application contract and browser runs. Screenshot understanding is deferred until labelled images and a separate modality baseline exist.

The acceptance target for curated deterministic cases is 100% case pass and zero safety violations, with provider errors counted as failures. Report action, origin/selection, constraints, route/evidence violations and latency/cost separately. Run each case at least three times before drawing a stability conclusion; do not select the best run. Compare any optimized harness to the same frozen cases and preserved legacy cases, then inspect failing traces. Do not treat an oracle test as a model or browser result.

## Blinded model baseline

`run-deepseek-baseline.mjs` sends only each case's request, catalog subset, origin options and frozen tool observations to DeepSeek. It never sends `gold`, case IDs, scoring code or expected item IDs. It records prompt/dataset/runner hashes, model name, token use, response and elapsed time in ignored `evals/runs/`. Temperature is zero, with one attempt per case; a provider failure is a missing prediction. The runner is a **model-only diagnostic**, not a production harness test.

`run-live-intent-harness.mjs` instead calls the production `createRecommendInterpreter` and `normalizeRecommendIntent` code on the frozen 34 request and 8 continuation cases. The optional `--holdout` flag runs 15 separate paraphrases and 4 continuations. It still supplies synthetic origin options; it does not exercise D1, geocoding, routes or browser clicks. Use a fresh output directory and compare its score and raw attempts with the baseline. A replay of baseline outputs through the new normalizer is development feedback, not an independent model run.

```sh
node --test evals/recommend/*.test.mjs
node --experimental-strip-types evals/recommend/score-entry-intent.mjs evals/recommend/intent-entry.v1.json
AGENT_API_KEY=... AGENT_MODEL=deepseek-chat node evals/recommend/run-deepseek-baseline.mjs evals/runs/recommend-formal-UNIQUE-NAME
AGENT_API_KEY=... AGENT_MODEL=deepseek-chat node --experimental-strip-types evals/recommend/run-live-intent-harness.mjs evals/runs/recommend-harness-UNIQUE-NAME
AGENT_API_KEY=... AGENT_MODEL=deepseek-chat node --experimental-strip-types evals/recommend/run-live-intent-harness.mjs evals/runs/recommend-holdout-UNIQUE-NAME --holdout
```

Keep the key out of shell history, source, reports and chat. The formal baseline starts only after these fixtures, scorers and the application contract are reviewed. The production decision code builds `reason` from verified structured facts; review its language independently. The final receipt rereads the database, takes its current canonical name and address, and rejects unknown, removed, unverified, changed or mismatched IDs and unsupported route claims. It does not ask the model to regenerate a shop name. A browser trace must record the request sequence, displayed response and opened detail ID for each contract case.

## Proposed application contract

`POST /api/recommend` is owner-authenticated, `no-store`, and accepts `{query: string, replies: string[], originChoice?: {hint: string, id: string}}`. The UI sends the original query with each answer; it never replaces the query with the answer. A geocoder choice carries the original lookup hint and selected candidate ID; the server rereads the candidate set and accepts only a uniquely matching current candidate. Bound query length, reply length and turn count, and treat all text as user data. The response is a discriminated union:

- `{status:"clarify", clarification, question, options?, originHint?}`: show a focused reply field and optional choices, allow keyboard submit, and keep the original query visible/editable.
- `{status:"recommend", recommendations:[{itemId, detailTargetId, name, address, reason, reasonFacts, route?, warnings?}]}`: each row opens `detailTargetId`, which must equal a verified saved `itemId`.
- `{status:"no_results"}`: no invented restaurant suggestions.
- `{status:"unavailable", retryable:boolean}`: keep the query and answers; offer Retry for a transient failure, but explain an unsupported provider region without a pointless Retry or an empty-search claim.

Restart clears the replies; editing the original query also starts a new request. An insufficient answer may return another clarification. Provider and route evidence must be server-verified on each request. This stateless request shape avoids persisting a personal conversation or trusting a client-supplied assistant role. The app may introduce an opaque conversation token later only if bounded replay proves insufficient; that change needs its own expiry and ownership tests.

The 14 contract cases specify initial request, continuation, structured geocoder choice, status, question, canonical database name, clickable saved detail, straight-line distance evidence with a travel-time caveat, verified walking evidence, provider failure, reason, retry draft and keyboard behavior. They must be filled from actual browser/API traces before calling the app journey accepted. A broad area alone permits area recommendations without timed claims; an explicit timed walking request needs a precise origin. A pasted shop name is an origin hint, including when the shop is already saved.

A scorer oracle shows only that the contract is internally consistent; it is not an application trace. Train-time accuracy and provider coverage are outside this PoC release benchmark.
