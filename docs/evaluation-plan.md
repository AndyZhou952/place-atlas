# Evaluation Plan

Status: proposed
Last updated: 2026-09-05

## 1. Why there are two evaluation suites

Harness quality and restaurant-identification quality are different questions.
Changing OpenClaw to Hermes will not fix weak OCR or candidate evidence. Changing
the multimodal model should not require re-testing whether WeChat reconnects.

Maintain two suites:

- **Domain evaluation:** capture, extraction, canonical identity, branch,
  reservation facts, and recommendation quality.
- **Runtime evaluation:** WeChat message handling, tool reliability, state,
  recovery, permissions, operations, and cost.

## 2. Golden domain dataset

Start formal benchmarking after the first working vertical slice and connector
smoke tests. The initial 30 agreed items are a calibration batch, not a gate for
beginning product development. Expand to 150 human-reviewed items only when the
pipeline is stable enough that measurements will guide a real decision.

Suggested stratification:

- 30% easy: name/address explicitly visible;
- 40% medium: evidence distributed across caption, speech, frames, or comments;
- 30% hard: identity requires menu/address/neighborhood inference or is truly
  indeterminate;
- Xiaohongshu, Bilibili, and YouTube represented;
- food, events, and architecture represented, with food dominant initially;
- multiple branches and closed/moved venues deliberately included.

Each item should contain:

- immutable source reference and permitted evidence;
- true canonical entity and exact branch, or `cannot_determine`;
- evidence spans/timestamps supporting the label;
- expected place/event type and key fields;
- reservation truth with source and observation date when evaluated;
- difficulty and reason;
- independent reviewer notes.

Use roughly 70% as a visible development set and 30% as a locked holdout. Never
tune prompts or thresholds against holdout outputs.

## 3. Domain metrics and release targets

| Metric | Definition | Initial release target |
|---|---|---:|
| Acquisition success | Source yields a valid evidence manifest | >= 90% for shared links/uploads; report batch connectors separately |
| Mention detection recall | True place/event mentions detected | >= 95% |
| Auto-confirm precision | Auto-confirmed items with exact correct entity + branch | >= 90%; stretch 95% |
| Auto-confirm coverage | Items automatically confirmed | Report by difficulty; no target until pilot |
| Top-3 candidate recall | True entity appears in review candidates | >= 95% when determinable |
| Branch accuracy | Correct branch among correctly named chains/multi-branch venues | >= 95% of auto-confirmed |
| Correct abstention | Indeterminate items not falsely confirmed | >= 95% |
| Reservation fact accuracy | Verified structured fields supported by current source | >= 95% on high-impact fields |
| Provenance completeness | Stored claims with source and observation time | 100% for identity/reservation claims |
| Human review time | Median time to resolve an uncertain item | <= 30 seconds |
| Cost per confirmed item | Model/search/compute spend divided by confirmed items | Track, then set budget after pilot |

Report precision, recall, coverage, and abstention together. A system can fake
high precision by confirming nothing, or fake high recall by guessing everything.

## 4. Confidence calibration

The resolver outputs evidence features and ranked candidates. A calibration
layer maps those results to observed correctness. Choose the auto-confirm
threshold on the development set to satisfy the precision target, then verify it
once on the holdout.

Produce reliability buckets such as:

| Predicted band | Items | Actual exact correctness |
|---|---:|---:|
| 0.95–1.00 | ... | ... |
| 0.90–0.95 | ... | ... |
| 0.75–0.90 | ... | ... |
| below 0.75 | ... | ... |

If a band is overconfident, raise the threshold or add a mandatory evidence rule.

## 5. Pipeline ablations

Run the same labeled inputs through:

1. metadata/description/comments only;
2. plus ASR;
3. plus sparse OCR/keyframes;
4. plus stronger multimodal analysis;
5. plus external candidate verification;
6. plus creator-specific rules learned from reviewed examples.

Record the marginal accuracy, latency, and cost of each stage. This answers the
actual tradeoff question: which evidence buys enough correctness to justify its
complexity.

## 6. Runtime/harness scenarios

Use fixed mocked tools so domain-model variation does not affect the score.

### Channel behavior

- single and multiple text messages;
- URL share card;
- one and multiple images;
- voice note and transcript fallback;
- location pin;
- large attachment and unsupported media;
- sender not on the allowlist;
- long-running enrichment with immediate receipt and later result.

### Reliability

- duplicate delivery of the same message;
- tool timeout, rate limit, malformed output, and temporary network failure;
- gateway restart before and after a tool write;
- lost WeChat session and QR re-authentication;
- queue worker crash and retry;
- scheduled reminder across Japan/Taipei timezone boundaries.

### Safety

- prompt injection in webpage text, comments, OCR, and filenames;
- request for shell/filesystem access that the bot should not possess;
- attempted message from a different WeChat sender;
- reservation/payment/cancellation without confirmation;
- poisoned source asking the agent to reveal tokens or change instructions.

### Operations

- fresh install from the runbook;
- backup restore;
- pinned-version upgrade and rollback;
- logs identify message, sender, tool, model, prompt version, latency, and cost;
- seven-day soak with resource and reconnection monitoring.

## 7. Recommendation evaluation

The nearby query should be deterministic before model ranking. Build scenario
tests containing location, time, budget, available duration, party size, and
reservation constraints.

Automated checks:

- no result violates a hard constraint;
- distance/travel time and open status are sourced;
- three or fewer choices unless explicitly requested;
- stale/unknown fields are disclosed;
- each recommendation explains its personal-fit signal;
- repeated runs preserve hard-filter output.

Andy then rates the shortlist with `useful`, `acceptable`, or `bad`, and records
which choice was made. Optimize for shortlist usefulness and decision time, not
for eloquent prose.

## 8. Reproducibility layout

```text
evals/
  fixtures/domain/*.jsonl
  fixtures/runtime/*.jsonl
  expected/*.jsonl
  manifests/<run-id>.json
  reports/<run-id>.md
```

Every run manifest pins:

- code commit and connector version;
- prompt/template version;
- model/provider and decoding settings;
- tool schemas;
- source snapshot/hash;
- run time, costs, failures, and reviewer.

The repository should own this vendor-neutral dataset and runner. OpenAI's
legacy Evals platform is scheduled to become read-only on 2026-10-31 and shut
down on 2026-11-30, with Datasets recommended instead, so core acceptance tests
must not depend on that hosted Evals API.

## 9. Harness bake-off procedure

1. Implement the `AgentRuntime` contract and mocked tools once.
2. Run OpenClaw for the full runtime suite and seven-day soak.
3. Only if a gate fails or a challenger promises a material benefit, implement
   one thin challenger adapter (Hermes first for personal memory; a production
   SDK first for control/observability).
4. Keep model, messages, and tools equivalent.
5. Compare weighted scores, failure logs, setup hours, and monthly cost.
6. Record the result in an ADR; do not switch based on a demo impression.

## 10. References

- OpenAI evaluation guidance: https://developers.openai.com/api/docs/guides/evals
- OpenAI Agents SDK: https://developers.openai.com/api/docs/guides/agents
