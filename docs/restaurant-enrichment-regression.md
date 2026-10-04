# Place Atlas restaurant links and schedules

Updated 2026-10-04. This report covers post-0.1.0 restaurant work, not all Place Atlas record types or worldwide reliability. Architecture/event research and agent/chat integrations have separate planned scope in [project scope](project-scope.md). The current collection rule is deliberately simple: Japanese restaurant schedules come only from the exact Tabelog listing; schedules elsewhere come from the selected Google Maps place. If a field is absent, it remains unavailable. The application reads these fields directly, so a model cannot replace them with remembered hours, snippets or another website.

## Current benchmark and database

Separate GPT-6 Luna research agents collected the 56 existing Japanese restaurants. The active `catalog-hours.v1.json` has benchmark ID `catalog-hours-tabelog-only-2026-10-04-v2` and covers every saved restaurant identity with its exact Tabelog URL, observation date and evidence.

| Field                  | Known | Unavailable |
| ---------------------- | ----: | ----------: |
| Opening hours          |    56 |           0 |
| Regular closing policy |    30 |          26 |

Nine listings also provide separate calendar closure notes. An all-days hours row alone does not establish a no-rest-days policy. Tabelog supplies Recoco's hours through its verified RECOCO listing; the listing's name and street address support the alias without inventing a quotation containing the saved English name.

Guarded updates aligned the existing D1 data with this benchmark. Only earlier automatically collected non-Tabelog schedule claims were withdrawn; unrelated fields and original profile evidence were preserved. Missing regular policies display Unavailable. Readback validates all 58 records, matches all 56 restaurant claims/statuses and leaves the backfill planner with zero changes. Private backups, exact old-payload/timestamp guards and guarded rollback files protect the repair.

D1 remains `japan-atlas-owner-poc` (`8accfff1-c41a-4e90-9a20-c215eea6b891`); media remains in R2 `japan-atlas-owner-poc-media`. No database was created, moved or reset. Schedule text, sources and observation dates survive review, Owner editing, confirmation, storage and browser display. There is no outbound restaurant contact in this workflow.

## Links and the original harness failure

| Restaurant        | Tabelog                                                      | Official website                                         | Alternative booking                                                     |
| ----------------- | ------------------------------------------------------------ | -------------------------------------------------------- | ----------------------------------------------------------------------- |
| RODEO, Nakameguro | [Listing](https://tabelog.com/tokyo/A1317/A131701/13213575/) | [Branch page](https://gf-restaurant.jp/rodeo/nakameguro) | [Toreta](https://yoyaku.toreta.in/rodeo-nakameguro/#/)                  |
| らぁ麺や 嶋       | [Listing](https://tabelog.com/tokyo/A1304/A130401/13247487/) | Standalone website unavailable                           | [TableCheck](https://www.tablecheck.com/ja/shops/ramenya-shima/reserve) |

The old harness conflated the Tabelog reservation-policy citation with a booking destination. Its lookup favored TableCheck and omitted Toreta, and optional booking-window details could cause a valid booking form to be discarded. Japan's linked official pages were also missed. The live evaluator checked reservation mode rather than the destination URL, so these defects escaped its gate.

The revised harness keeps policy evidence, listing, official website and actionable booking destination separate. It recognizes TableCheck/Toreta merchant forms independently of optional timing, verifies the selected branch, preserves required URL parameters and SPA routes, and permits only a bounded same-merchant TableCheck language redirect. Verified fields survive same-identity refresh and confirmation. Map and Table share one link selector: one Tabelog link, plain `予約可`/`予約不可`, and separate official/alternative booking links only when their destinations differ.

The original snapshots are marked `owner_asserted`; there is no retained historical model trace proving DeepSeek introduced those errors. Current source or identity failures are reported as failures, rather than attributed to a model without evidence. 嶋's saved/Google address says Honmachi 3-41-11 while Tabelog/TableCheck say 3-41-12; the strict identity limitation remains, and the saved location was not silently changed.

## Refresh behavior

The five-to-58 jump came from initializing the browser with five bundled demonstration records before requesting D1. The browser now starts with an empty catalog and displays Loading saved Atlas records until the real response arrives. It then renders the saved catalog. A failed first request exposes Retry, and a later refresh retains the last loaded records with a clear status. Journal/media requests have independent errors and cannot cause a catalog failure.

A previous deployment also exposed an outdated browser decoder requiring every reservation URL. That rejection was repaired with an optional URL and a mixed-catalog browser regression. The new loading state removes the demonstration fallback entirely.

## Evaluation and evidence

The active benchmark expects only Tabelog schedule sources. Contract tests reject off-listing/non-Tabelog claims, wrong identities and unsupported aliases; the production reader gate exercises all 56 captured Tabelog pages. Tests cover meaningful hour differences, lunch/dinner periods, last orders, fixed/conditional closures, seasonal separation, unavailable-field suppression and persistence through public/browser boundaries. Regional tests prohibit Japanese Google/official schedule fallback and model-proposed schedule overrides; overseas schedules use the selected Google place.

The earlier multi-source benchmark and reports remain historical evidence. Its gold is archived in `evals/add-behavior/historical/catalog-hours.multi-source.2026-10-04.json`; the [dated full-run report](../apps/web/evals/add-behavior/catalog-hours-live-results.2026-10-04.json) must not be interpreted as acceptance of the new Tabelog-only policy. Under that earlier contract, the baseline passed 12/56 strict checks and the revised run passed 17/56. A subsequent four-case calendar repair check passed 4/4, a partial follow-up rather than a full-catalog claim. Parallel runners that reused one credential invalidated each other's sessions; a local exclusive lock and per-case checkpoints now protect the runner.

For the original link examples, the configured deployed provider passed 2/2 combined links/hours checks with Tabelog discovery and 1/2 with normal Google discovery; 嶋 failed the known address conflict. These are small source/identity diagnostics, not a general model reliability estimate. Model response identifiers were not independently observed. All evaluation sessions use discover/select/cancel without confirming or saving; expected answers stay in the local scorer. The [link report](../apps/web/evals/add-behavior/restaurant-live-results.2026-10-04.json) preserves intermediate failures.

The current Tabelog-only deployment was checked again on the two original examples through normal Google discovery: RODEO passed its schedule checks and returned the correct Toreta destination; 嶋 failed before schedule scoring at the same address-identity conflict. Both sessions were canceled. This 1/2 partial result is recorded separately in the [current-policy report](../apps/web/evals/add-behavior/catalog-hours-live-results.tabelog-only.2026-10-04.json). It does not replace the captured-page or database checks, and the full 56-case live run has not been repeated under the simplified policy.

Final deployed Worker version is `e0dabd9b-7926-4cc2-a1e5-c04933383a3a`. All 1,077 tests, lint, typecheck, formatting, migration packaging and Owner build/preflight pass. Browser acceptance confirms Loading followed by all 58 records, Recoco's sourced Tabelog hours/Unavailable closing policy, and a listing link independent of its unknown rating. Deployment and final validation are recorded in `docs/status.md`. PR #34 remains open; production uses the existing D1/R2/sidecar bindings and daily schedule, with preview URLs disabled.
