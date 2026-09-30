# Recommend evaluation v1

The 92-case model-only benchmark was frozen before the formal baseline; later application and decision extensions are tracked separately. It evaluates the proposed **Recommend** journey over saved restaurants. The existing `../nearby/` suites remain as retention gates; their 14 policy and 10 station cases are included in the model baseline without changing their labels.

## Gates and evidence

| Layer                               | Dataset                    |   Cases | Verifier             | Evidence boundary                                                                                   |
| ----------------------------------- | -------------------------- | ------: | -------------------- | --------------------------------------------------------------------------------------------------- |
| Short request interpretation        | `intent-gold.v1.json`      |      34 | `score-intent.mjs`   | Synthetic text and origin options; no geocoding claim                                               |
| Clarification continuation          | `dialogue-gold.v1.json`    |       8 | `score-intent.mjs`   | Ordered dialogue with a synthetic option set; no live conversation claim                            |
| Saved catalog and route decision    | `decision-gold.v1.json`    |      26 | `score-decision.mjs` | Frozen catalog and tool observations; no live route claim                                           |
| Resolved-origin proximity extension | `decision-spatial.v1.json` |       6 | `score-decision.mjs` | Added after the frozen baseline; protects near-origin distance and progressive fallback behavior    |
| Saved entry-rule extension          | `decision-entry.v1.json`   |       4 | `score-decision.mjs` | Added after the frozen baseline; separates sourced walk-in rules, unknown rules and advance booking |
| API and browser journey             | `contract-gold.v1.json`    |      15 | `score-contract.mjs` | Requires a browser/API trace from the application; oracle tests only validate the scorer            |
| Retained policy and station cases   | `../nearby/`               | 14 + 10 | Existing scorers     | Historical synthetic policy and officially checked station identity cases                           |

The original 92 model-only cases are intentionally separate from the 15 application traces. The later 6-case proximity and 4-case entry extensions and 15+4 paraphrase set are reported separately from that frozen baseline. The model baseline cannot prove that the production app called its tools, preserved an answer through the UI, or opened the right restaurant detail. Those require application contract and browser runs. Screenshot understanding is deferred until labelled images and a separate modality baseline exist.

The acceptance target for curated deterministic cases is 100% case pass and zero safety violations, with provider errors counted as failures. Report action, origin/selection, constraints, route/evidence violations and latency/cost separately. Run each case at least three times before drawing a stability conclusion; do not select the best run. Compare any optimized harness to the same frozen cases and preserved legacy cases, then inspect failing traces. Do not treat an oracle test as a model or browser result.

## Blinded model baseline

`run-deepseek-baseline.mjs` sends only each case's request, catalog subset, origin options and frozen tool observations to DeepSeek. It never sends `gold`, case IDs, scoring code or expected item IDs. It records prompt/dataset/runner hashes, model name, token use, response and elapsed time in ignored `evals/runs/`. Temperature is zero, with one attempt per case; a provider failure is a missing prediction. The runner is a **model-only diagnostic**, not a production harness test.

`run-live-intent-harness.mjs` instead calls the production `createRecommendInterpreter` and `normalizeRecommendIntent` code on the frozen 34 request and 8 continuation cases. The optional `--holdout` flag runs 15 separate paraphrases and 4 continuations. It still supplies synthetic origin options; it does not exercise D1, geocoding, routes or browser clicks. Use a fresh output directory and compare its score and raw attempts with the baseline. A replay of baseline outputs through the new normalizer is development feedback, not an independent model run.

```sh
node --test evals/recommend/*.test.mjs
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

The 15 contract cases specify initial request, continuation, structured geocoder choice, status, question, canonical database name, clickable saved detail, verified route evidence, unsupported-provider explanation, average-route disclosure, reason, retry draft and keyboard behavior. They must be filled from actual browser/API traces before calling the app journey accepted. The separate intent and dialogue cases protect broad area semantics: a broad area alone permits area recommendations without timed claims; a timed walk/train request needs a precise origin. A pasted shop name is an origin hint, including when the shop is already saved.
