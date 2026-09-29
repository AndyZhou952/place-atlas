# PoC remaining work

Updated: 2026-09-29. This file tracks unfinished project work only. Architecture and boundaries are in `docs/architecture.md`; evaluation datasets and runners stay under `apps/web/evals/`.

## 1. Nearby: prepare the benchmark before the Agent

- [ ] **Freeze an independent behavior set.** Extend the existing synthetic policy and multilingual station seeds with real saved-catalog questions: short Japanese/Chinese/English location hints, ambiguous stations, food/price/time intent, visited preference, no nearby match, walking/transit fallback, and provider failure. Keep expected restaurant IDs, route facts, and acceptable clarifications evaluator-side; do not pass answers to the Agent. Add negative cases for unsaved restaurants, straight-line distance presented as walking time, invented queues, and wrong station branches.
- [ ] **Ground route and entry labels.** Capture independent source evidence and observation dates for location, walking/transit time, reservation or walk-in policy, and unknown availability. Treat an external API error as unavailable evidence, never as “no restaurants found.” Label screenshot/location cases before any image-based recognition is enabled.
- [ ] **Define release metrics.** Score location resolution, clarification, saved-place selection, route/entry factuality, unsupported claims, latency, tool calls, and provider cost separately. Report pass@1 and repeated-run reliability for the real model; keep synthetic fixtures and live runs in separate reports. Put raw traces only in ignored `evals/runs/` and promote independently verified failures into regression cases.

## 2. Nearby: build and verify the harness

- [ ] **Connect the Agent to bounded tools.** Resolve a user's location and constraints, retrieve only saved Atlas restaurants and current personal state, request route evidence, then rank and explain options. Ask a clarification when a station or branch cannot be identified. Keep model output behind schema, identity, evidence, budget, and timeout checks; the Agent must not write personal records.
- [ ] **Enforce recommendation rules.** Prefer unvisited restaurants with a sourced 10–15 minute walk. If none qualify, offer a clearly labelled distance-only fallback within 2 km or a sourced direct-transit option within 20 minutes door-to-door. Never convert straight-line distance into walking time. State reservation, walk-in, queue, and opening uncertainty honestly.
- [ ] **Run end-to-end acceptance.** Score the configured real model on the frozen set, fix observed failures without weakening the retained Add/Record regressions, and verify deployed browser queries, clarification, routes, and refreshed saved-catalog/personal-state readback.

## 3. Remaining Add and shared release gates

- [ ] **Measure independent Add resolution quality.** Run real-model predictions on the existing place-resolution gold set and report branch correctness, uncertainty, tool/latency cost, and source failures separately from frozen-evidence extraction and the named live Add journeys. Extend the named live set when a production miss is observed, with a nearby-branch negative control.
- [ ] **Audit boundaries and retention.** Check anonymous/public fields against private notes, media, owner settings, Agent sessions, and audit records. Verify owner auth, all accepted write paths, session expiry, mutation receipts, retries, and failure rollback without exposing private data.
- [ ] **Validate the deployed stack as one system.** Recheck the intended D1/R2 bindings and migrations, durable media, map markers, Add → Record → Nearby catalog consistency, and visibility after refresh. Rerun the live Add and Record gates alongside Nearby; a local or synthetic pass alone does not close this gate.
- [ ] **Prove reproducible setup.** Walk through the root README on a fresh configuration from credentials and migrations to the first successful Add, Visit, and Nearby recommendation. Record only project-level blockers here.

## Next execution order

1. Freeze Nearby gold cases and independent route/entry evidence.
2. Implement the bounded Nearby harness and deterministic validators.
3. Run real-model benchmarks, repair failures, and repeat deployed browser journeys.
4. Close the shared security, persistence, regression, and fresh-setup gates.
