# Restaurant links and Japanese opening hours

Verified on 2026-10-04. This change repairs two independently researched production examples and adds regression gates around the actual Add workflow. The benchmark was collected by separate GPT-6 Luna agents before the internal model was evaluated. The expected answers remain in the local scorer; the model receives only the normal restaurant query and source evidence.

## Verified data

| Restaurant | Listing | Official website | Booking destination | Hours and regular closure |
| --- | --- | --- | --- | --- |
| RODEO, Nakameguro | [Tabelog](https://tabelog.com/tokyo/A1317/A131701/13213575/) | [Branch page](https://gf-restaurant.jp/rodeo/nakameguro) | [Toreta](https://yoyaku.toreta.in/rodeo-nakameguro/#/) | Official: Mon–Fri 17:00–23:00; Sat/Sun/holidays 12:00–14:00 and 17:00–23:00. Lunch last order 13:00; last entry 21:30. No independently established weekly closure. |
| らぁ麺や 嶋 | [Tabelog](https://tabelog.com/tokyo/A1304/A130401/13247487/) | Standalone website unknown; official social accounts remain distinct. | [TableCheck](https://www.tablecheck.com/ja/shops/ramenya-shima/reserve) | Current listing: Mon–Fri 08:15–14:30; Sat/Sun/holidays closed. Entry slots are retained separately from the operating interval. |

The hours manifest records conflicts rather than merging incompatible facts: Tabelog lists RODEO's Sunday/holiday dinner close as 22:00, while its official branch page says 23:00. An older 嶋 review starts at 08:45; the current listing starts at 08:15. Reservation release times do not establish opening hours. RODEO's seasonal New Year closure does not establish a fixed weekly rest day.

For 嶋, Google and the saved catalog address say Honmachi 3-41-11, while the current Tabelog and TableCheck pages say 3-41-12. This change preserves the saved address and the strict branch gate. Address reconciliation requires independent verification; matching names alone do not authorize changing a location or borrowing another branch's facts.

## Why the previous harness missed this

The Tabelog reservation row supplied a policy citation, and the system displayed that URL as the booking destination. The booking lookup favored TableCheck and omitted Toreta. TableCheck acceptance also depended on optional release timing or an official-host hint; a working reservation form without those details could be discarded. Japan's linked official pages were not read through the overseas official-site path.

A quoted URL was insufficiently distinguished from an actionable booking endpoint. Refresh replaced profiles instead of preserving verified fields, and confirmation compared the listing and reservation snapshots without stabilizing the profile. The live Japan evaluator tested reservation mode, leaving incorrect destination URLs undetected. A frozen model-only benchmark even accepted a general Tabelog listing as a booking link; that runner was not the production Add harness.

These are reproducible harness failures. The original saved snapshots are marked `owner_asserted`; there is no retained historical model trace establishing that DeepSeek introduced them. A current failed preview does not prove historical blame.

## What changes

* Independently parse TableCheck and Toreta merchant pages, match restaurant name and branch address, and keep booking-form recognition separate from optional booking timing. Follow at most one TableCheck language redirect that retains the exact merchant path; reject another host, shop, or second redirect. Provider hints narrow search to the named booking platform. An arbitrary policy anchor cannot impersonate an official-site relationship.
* Read bounded Japanese official pages linked by the verified listing. Only branch-matched pages can authorize booking anchors and structured operating hours. A sister branch's embedded CMS payload supplies no facts.
* Require independently verified booking destinations. A general Tabelog listing remains a policy citation unless an actual booking path is verified. Keep the policy source and original assertion timestamp separate from the public booking button.
* Preserve known profile fields during same-identity refresh, compare profile facts at confirmation, and project official/booking links separately with duplicate-source suppression. Toreta's `#/` route survives publication and public validation.
* Collect sourced opening-hours text and fixed weekly rest days during Add; prefer the branch's official schedule over conflicting listing data. Persist source URLs and observation dates through review, confirmation, catalog storage and display. Missing schedules remain unknown. Owner edits remain possible; no outbound restaurant contact is performed.
* Gate exact booking URLs, source evidence, day-to-time assignments, lunch/dinner splits, fixed closures, wrong branches, spoof anchors, provider/model failure recovery and publication readback. Negative controls reject swapped weekday schedules and omitted midweek days.

## Database repair

The two production rows have verified booking profile/source links; RODEO also has its exact official branch URL. Both have dated, sourced hours; 嶋 has fixed closure days. Compare-and-swap SQL guarded the exact identity, old payload and update timestamp, with backups and guarded rollback. Personal visits, media, ratings, location and classification were preserved. The original policy citations and assertion dates were preserved too.

The hours backfill uses root sourced fields for compatibility with the previous deployed validator; future publication stores the reviewed profile and public fields together. The Owner subsequently authorized deploying the branch to the existing site. Deployment reuses D1 `japan-atlas-owner-poc` and R2 `japan-atlas-owner-poc-media`; no database was moved or recreated, and no migration was needed. A private full D1 export was saved before deployment.

The first deployment exposed a missed browser boundary: the public manifest correctly omitted a policy-only booking URL, but the browser decoder still required it. One policy-only row rejected the whole catalog and displayed five demo records. Production was rolled back immediately. The fix makes that URL optional and preserves sourced schedules in the browser model. A mixed-catalog manifest-to-browser regression now covers this failure, including the Toreta fragment and hours/closing days.

The Owner clarified the display rule: reservation policy labels stay non-clickable; retain one Tabelog destination and show separate official and booking destinations only when they exist and differ. Both Map and Table use the same destination selector, suppress Tabelog policy duplicates and identical official/booking URLs, and preserve stored policy evidence.

The corrected version `354709d7-81ba-4c70-99db-6dfb4e422099` is deployed. Actual browser acceptance loaded all 58 records without the demo fallback, verified RODEO's official/Toreta links and schedule, verified 嶋's TableCheck link and weekday hours/weekend-holiday closure, and checked a policy-only restaurant displays one Tabelog destination with plain `予約不可`. RODEO's expanded Table details also show the three distinct destinations without a duplicate reservation-source link. Existing bindings and the daily schedule are retained; preview access stays disabled. PR #34 remains open.

## Evaluation results

| Run | Configuration | Link result | Interpretation |
| --- | --- | --- | --- |
| Previous deployed workflow | Normal Google discovery | 0/2 | RODEO missed the booking destination; 嶋 remained incomplete with the address conflict. Both reached preview and were canceled. |
| Revised isolated preview | Normal Google discovery | 1/2 | RODEO supplied the correct Toreta link; 嶋 remained blocked by the 3-41-11 / 3-41-12 conflict. |
| Revised isolated preview | Tabelog discovery, Google discovery disabled | 2/2 | Both exact branches supplied correct destinations. This diagnostic changes the identity provider; it is not a paired 100% improvement claim. |

Live runs use the deployed configured provider, without a model stub, and discover/select/cancel only. Controlled tests, live source availability, database repair and published UI acceptance are separate measures. These two examples do not estimate general model reliability. The first combined hours run failed 0/2: RODEO used the conflicting listing schedule and the model promoted 年末年始 to a weekly closure; the hours scorer also misparsed 嶋's flattened 定休日 text. The fixes add same-origin group JSON-LD as branch-fetch hints, prevent model substitution for structured business-row hours, and correct the scorer's day-label boundary. Follow-up combined runs passed RODEO's full links/hours checks and 嶋's hours, but missed 嶋's booking link (1/2 overall). Independent source-stage reproduction found the exact locale-free TableCheck result returning HTTP302 to the expected Japanese merchant URL; the old redirect denial caused the missing link. A bounded same-merchant language redirect fixes that stage, with wrong-host/shop and redirect-loop negatives.

Fixed provider/model diagnostic codes were added. Preview traffic did not yield those events through Wrangler tail, so the live response does not independently establish the configured model identifier. Report the live provider as the deployed configured provider rather than asserting an observed response-model ID.


Final checked candidate: **2/2 combined links/hours cases pass with Tabelog discovery; 1/2 pass with normal Google discovery**. In the latter run, RODEO passes all checks and 嶋 fails at its known address mismatch; missing downstream fields are reported as failures rather than filled from a conflicting branch. All temporary sessions were canceled. Earlier intermediate failures remain in the [dated run summary](../apps/web/evals/add-behavior/restaurant-live-results.2026-10-04.json); the earlier Google combined run also failed RODEO's booking/official-hours lookup, so this small set does not establish consistent external-source availability.

Original candidate validation passed all 1,029 automated tests, formatting, lint, type checking, migration packaging, Owner build and route-sidecar bundle. Both repair planners proposed zero changes against the final database export. After the browser fix and clarified destination display, all 1,033 automated tests, lint, type checking, Owner build and deployment preflight pass. The live browser acceptance above is separate from API/database readback and the isolated intake benchmarks. Original policy assertion dates remain unchanged.
