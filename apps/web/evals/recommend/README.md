# Recommend evaluation

These suites evaluate Place Atlas recommendations from saved restaurants. They do not establish architecture/event recommendations, image understanding or framework/chat integration. See [project scope](../../../../docs/project-scope.md).

The model-only benchmark has 79 cases covering saved restaurants, straight-line distance and explicit walking. The 14 application contracts and later decision extensions are tracked separately. The `../nearby/` suite contributes 11 policy and 10 station cases.

## Gates and evidence

| Layer                            | Dataset                  |   Cases | Verifier                 | Evidence boundary                                                                        |
| -------------------------------- | ------------------------ | ------: | ------------------------ | ---------------------------------------------------------------------------------------- |
| Short request interpretation     | `intent-gold.v1.json`    |      31 | `score-intent.mjs`       | Synthetic text and origin options; no geocoding claim                                    |
| Clarification continuation       | `dialogue-gold.v1.json`  |       6 | `score-intent.mjs`       | Ordered dialogue with a synthetic option set; no live conversation claim                 |
| Saved catalog and route decision | `decision-gold.v1.json`  |      21 | `score-decision.mjs`     | Frozen catalog and tool observations; no live route claim                                |
| Resolved-origin proximity policy | `decision-spatial.json`  |       6 | `score-decision.mjs`     | Current policy: straight-line distance by default; explicit walking remains strict       |
| Proximity intent policy          | `intent-proximity.json`  |       9 | Production normalizer    | Model output cannot invent a mode, origin or walking limit; driving fails honestly       |
| Saved entry-rule extension       | `decision-entry.v1.json` |       4 | `score-decision.mjs`     | Separates sourced walk-in rules, unknown rules and advance booking                       |
| Entry wording extension          | `intent-entry.v1.json`   |       5 | `score-entry-intent.mjs` | Distinguishes walk-in entry from walking duration with adversarial model predictions     |
| API and browser journey          | `contract-gold.v1.json`  |      14 | `score-contract.mjs`     | Requires a browser/API trace from the application; oracle tests only validate the scorer |
| Policy and station cases         | `../nearby/`             | 11 + 10 | Existing scorers         | Synthetic policy and officially checked station identity cases                           |

The model runners read the 79 active cases directly. The application contract and proximity extensions require default straight-line distance or evidence-backed walking only. The 6-case proximity decision, 9-case proximity intent, 4-case entry-decision, 5-case entry-wording and 15+4 paraphrase sets are reported separately. The entry-wording and proximity-intent extensions run the production deterministic guard against fixed, sometimes incorrect model predictions; they do not measure fresh DeepSeek performance. The model benchmark cannot prove that the production app called its tools, preserved an answer through the UI, or opened the right restaurant detail. Those require application contract and browser runs. Screenshot understanding is deferred until labelled images and a separate modality baseline exist.

The acceptance target for curated deterministic cases is 100% case pass and zero safety violations, with provider errors counted as failures. Report action, origin/selection, constraints, route/evidence violations and latency/cost separately. Run each case at least three times before drawing a stability conclusion; do not select the best run. Compare any optimized harness to these same cases, then inspect failing traces. Do not treat an oracle test as a model or browser result.

## Blinded model baseline

`run-deepseek-baseline.mjs` sends only each case's request, catalog subset, origin options and fixed tool observations to DeepSeek. It never sends `gold`, case IDs, scoring code or expected item IDs. It records prompt/dataset/runner hashes, model name, token use, response and elapsed time in ignored `evals/runs/`. Temperature is zero, with one attempt per case; a provider failure is a missing prediction. The runner is a **model-only diagnostic**, not a production harness test.

`run-live-intent-harness.mjs` instead calls the production `createRecommendInterpreter` and `normalizeRecommendIntent` code on 31 request and 6 continuation cases. The optional `--holdout` flag runs 15 separate paraphrases and 4 continuations. It still supplies synthetic origin options; it does not exercise D1, geocoding, routes or browser clicks. Use a fresh output directory and compare its score and raw attempts with the baseline. A replay of baseline outputs through the normalizer is development feedback, not an independent model run.

```sh
node --test evals/recommend/*.test.mjs
node --experimental-strip-types evals/recommend/score-entry-intent.mjs evals/recommend/intent-entry.v1.json
AGENT_API_KEY=... AGENT_MODEL=deepseek-chat node evals/recommend/run-deepseek-baseline.mjs evals/runs/recommend-formal-UNIQUE-NAME
AGENT_API_KEY=... AGENT_MODEL=deepseek-chat node --experimental-strip-types evals/recommend/run-live-intent-harness.mjs evals/runs/recommend-harness-UNIQUE-NAME
AGENT_API_KEY=... AGENT_MODEL=deepseek-chat node --experimental-strip-types evals/recommend/run-live-intent-harness.mjs evals/runs/recommend-holdout-UNIQUE-NAME --holdout
```

Keep the key out of shell history, source, reports and chat. The formal baseline starts only after these fixtures, scorers and the application contract are reviewed. The production decision code builds `reason` from verified structured facts; review its language independently. The final receipt rereads the database, takes its current canonical name and address, and rejects unknown, removed, unverified, changed or mismatched IDs and unsupported route claims. It does not ask the model to regenerate a shop name. A browser trace must record the request sequence, displayed response and opened detail ID for each contract case.

## Application contract

`POST /api/recommend` is owner-authenticated, `no-store`, and accepts `{query: string, replies: string[], originChoice?: {hint: string, id: string}}`. The UI sends the original query with each answer; it never replaces the query with the answer. A geocoder choice carries the original lookup hint and selected candidate ID; the server rereads the candidate set and accepts only a uniquely matching current candidate. Bound query length, reply length and turn count, and treat all text as user data. The response is a discriminated union:

- `{status:"clarify", clarification, question, options?, originHint?}`: show a focused reply field and optional choices, allow keyboard submit, and keep the original query visible/editable.
- `{status:"recommend", recommendations:[{itemId, detailTargetId, name, address, reason, reasonFacts, route?, warnings?}]}`: each row opens `detailTargetId`, which must equal a verified saved `itemId`.
- `{status:"no_results"}`: no invented restaurant suggestions.
- `{status:"unavailable", retryable:boolean}`: keep the query and answers; offer Retry for a transient failure, but explain an unsupported provider region without a pointless Retry or an empty-search claim.

Restart clears the replies; editing the original query also starts a new request. An insufficient answer may return another clarification. Provider and route evidence must be server-verified on each request. This stateless request shape avoids persisting a personal conversation or trusting a client-supplied assistant role. The app may introduce an opaque conversation token later only if bounded replay proves insufficient; that change needs its own expiry and ownership tests.

The 14 contract cases specify initial request, continuation, structured geocoder choice, status, question, canonical database name, clickable saved detail, straight-line distance evidence with a travel-time caveat, verified walking evidence, provider failure, reason, retry draft and keyboard behavior. The scorer checks user-visible distance/route text and rejects timed claims on default-distance answers or unsupported route modes. The cases must be filled from actual browser/API traces before calling the app journey accepted. A broad area alone permits area recommendations without timed claims; an explicit timed walking request needs a precise origin. A pasted shop name is an origin hint, including when the shop is already saved.

A scorer oracle shows only that the contract is internally consistent; it is not an application trace.

## Captured application acceptance

`serve-browser-acceptance.mjs` serves the deployed UI on localhost and records its actual Recommend requests and responses. In `live` mode it forwards to the deployed Owner API using a cookie read from `ATLAS_OWNER_COOKIE_FILE`. Bind only to localhost, keep that file outside the repository with restrictive permissions, and remove it after stopping the recorder. All other writes are blocked. `ATLAS_ACCEPTANCE_PORT` and `ATLAS_ACCEPTANCE_TRACE` select the port and ignored JSONL output.

The `branch-choice`, `empty-catalog` and `provider-failure` modes exercise the production conversation service and response handler with isolated dependencies. These three scenarios test UI continuation and failure handling; they do not measure DeepSeek or production authentication. The branch fixture deliberately returns an overconfident model choice so the application must still ask the user to select a branch.

`deployed-contract-bindings.json` binds the 14 semantic contracts to independent public source URLs in a saved catalog snapshot. Expected names, addresses and IDs are resolved from that snapshot, never copied from model output. Save the snapshot as `catalog.json`, raw HTTP traces as `browser-<scenario>.jsonl`, and observed DOM text, clicked detail IDs and keyboard/reset/retry observations as `browser-observations.json` in one ignored run directory. Score with:

```sh
node --experimental-strip-types evals/recommend/score-captured-contract.mjs evals/runs/UNIQUE-CAPTURE
```

The scorer requires a contiguous captured request sequence, browser observations and exact current saved identity for every returned restaurant. Missing evidence fails. The 2026-10-01 release acceptance passed 14/14: 11 deployed model/service journeys and three isolated application scenarios. Exploratory attempts remain in the raw traces; the scorer uses the latest matching acceptance sequence. This is a functional acceptance report, not first-attempt reliability or repeated-run stability. No result from a controlled dependency is counted as a live-model success.
