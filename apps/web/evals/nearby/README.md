# Nearby benchmark: policy seed v1

This is a **synthetic, offline policy suite**, not a measured Agent benchmark or evidence of real travel times. Build the benchmark before connecting the recommendation Agent. Actual place/location interpretation, screenshots and live route providers need additional evaluation.

The 14 cases cover Chinese/Japanese/English short input, cuisine constraints, default unvisited preference, an explicit visited request, the 15-minute walking boundary, 2 km distance fallback, direct transit at the 20-minute door-to-door boundary, transfers, ambiguous locations, provider failure, an empty saved catalog, and unknown walk-in status. The catalog and route durations are fictional test inputs, not claims about Tokyo restaurants.

## Input and output boundary

Give the system under test only `input` plus the referenced saved catalog. Routes and location state represent tool observations. Never expose `gold`. In this version, the origin/tool state is already resolved or explicitly ambiguous; multilingual wording does not establish that a model can independently geocode those messages.

Prediction shape:

```json
{
  "datasetId": "nearby-policy-v1",
  "predictions": [
    {
      "caseId": "walk-zh",
      "action": "recommend",
      "itemIds": ["ramen-a"],
      "warnings": [],
      "routeClaims": [{ "itemId": "ramen-a", "mode": "walk", "seconds": 600 }],
      "telemetry": { "latencyMs": 200, "toolCalls": 2, "costUsd": 0.001 }
    }
  ]
}
```

Actions are `recommend`, `clarify`, `no_results`, or `unavailable`. A clarification needs a nonempty `question`. Echo explicit warnings such as `unverified_travel_time`, `walk_in_unknown`, or `location_provider_unavailable`. A distance-only candidate must not acquire a made-up walking duration. Route claims must match the tool evidence. A provider outage is not an empty catalog.

## Scoring

From `apps/web`:

```sh
node --test evals/nearby/score-nearby.test.mjs
node evals/nearby/score-nearby.mjs evals/nearby/nearby-gold.v1.json evals/runs/nearby-predictions.json
```

The second command requires real predictions; no generated perfect prediction file is shipped. Tests create an oracle in memory solely to validate the scorer. CLI exit codes: 0 passes, 1 fails quality gates, 2 invalid input.

Report case coverage, action accuracy, selection accuracy, uncertainty coverage, safety violation cases, case pass rate and per-case failures. Optional per-case telemetry reports mean latency, total tool calls and total cost only when every case supplies it. Require all 14 core-policy cases to pass: no unsaved recommendations, unsupported route claims, lost uncertainty warnings or unsafe ambiguity handling. Missing predictions count as failures. This small strict seed is not a claim about statistical accuracy.

The proposed acceptance gate for a future independently verified, real-model set is zero invented saved-place IDs, route times or booking facts; every ambiguity and provider-failure safety case must pass. Set action/selection thresholds after reviewing that dataset, before running the model. Do not use this synthetic oracle to tune or claim real-model quality.

## Before live Agent acceptance

- Add independently checked real locations and candidate catalogs, including aliases and ambiguous place names.
- Add labelled map screenshots; do not represent screenshot understanding with a text-only fixture.
- Check location understanding separately from ranking over supplied tool evidence.
- Add reservation conflicts, outdated sources and direct-transit route availability for supported regions.
- Measure end-to-end latency, tool count, provider failure rate and cost on real runs.
- Human-review explanation usefulness and grounding; this scorer evaluates structured decisions, not arbitrary narrative claims.
- Keep recommendations restricted to the user's saved catalog; external search may clarify an origin or entry rules, not silently add unfamiliar restaurants.
