# Decision Log

This is the lightweight index for product and engineering choices. Material
technical choices receive a separate ADR; open questions remain explicitly open.

| Date | Area | Decision/status | Rationale / follow-up |
|---|---|---|---|
| 2026-09-05 | Product | Private, single-user, map-first personal atlas | Optimize for Andy's daily convenience, not public-market feature breadth |
| 2026-09-05 | Interaction | WeChat is the primary capture/command surface; PWA is the visual source of truth | Fast capture plus better browsing/editing than chat alone |
| 2026-09-05 | Runtime | Proposed: OpenClaw as replaceable gateway/runtime | Best current WeChat fit; must pass soak/security evaluation; see ADR 0001 |
| 2026-09-05 | Core | Domain API/database must not depend on the agent harness | Preserves data and permits later runtime replacement/public extraction |
| 2026-09-05 | Deployment | Proposed: cloud product plane + local browser acquisition | 24/7 availability without exporting social login/browser control; see ADR 0002 |
| 2026-09-05 | Accuracy | >=90% applies to exact auto-confirm precision, with abstention | Avoids silently corrupting the map on ambiguous videos |
| 2026-09-05 | Sources | Share-to-inbox is the reliable default; `web-access` is optional | No suitable stable official bulk API; connectors are fragile and replaceable |
| 2026-09-05 | Evaluation | Separate domain and harness suites; repository-owned fixtures | Avoid confounding channel/runtime with extraction/model quality |
| 2026-09-05 | Public version | Not part of v1; maintain extraction-friendly interfaces/config separation | Enables later portfolio/open-source work without slowing travel readiness |
| 2026-09-05 | Time model | Core product is date-independent and uses rolling windows/freshness | Travel dates affect prioritization, not architecture |
| 2026-09-05 | UI architecture | MVVM-inspired Views/ViewModels over a framework-neutral domain API | Testable UI separation without forcing MVVM onto workers/backend |
| 2026-09-05 | Legacy repo | Preserve `food-map` unchanged and build the new product from scratch | The prototype is optional product research, not a code or architecture baseline |
| 2026-09-05 | Early evaluation | Begin with smoke cases; run the agreed 30-item calibration after ingestion works | Most sources are explicit; benchmarking should not delay the foundation |
| 2026-09-06 | Product data | Remove demo fixtures; only source-checked records or explicit review candidates may appear | Prevents placeholder content from being mistaken for Andy's trusted map |
| 2026-09-06 | Persistence | D1-backed API before OpenClaw; keep the store replaceable | Website and future agent require one durable source of truth; see ADR 0003 |
| 2026-09-06 | Names | Japanese-first display titles with optional alternate name | Matches Andy's language preferences and avoids unnecessary translation |
| 2026-09-06 | Ratings | Tabelog and personal ratings are separate dated facts | External scores change and must retain provenance |
| 2026-09-06 | Acquisition | Web Access is an important first collector, not a core-domain dependency | Enables creator-level collection while containing platform/login fragility |
| 2026-09-06 | Interface ownership | WeChat Agent is the primary capture/action surface; the map is the primary browsing/memory surface | Avoids duplicating workflows while preserving a rich spatial record |
| 2026-09-06 | Personal rating | One nullable persistent rating per Atlas item, separate from repeatable visits | Museums may be unrated and repeat visits must not create competing place scores |
| 2026-09-06 | Visit history | Derive visit number and visited state from visit records | Prevents duplicate items and contradictory manual state |
| 2026-09-06 | Media | Store bytes in object storage and captions/relations in D1 | Supports durable photos without bloating structured storage |
| 2026-09-06 | Transitional UI | Keep Inbox/Journal only until Agent parity, then replace with map detail and contextual review links | Do not remove the only working write path prematurely |
| 2026-09-06 | Rating input | Manual entry accepts any finite 0–5 value; future quick controls use 0.5 increments | Preserves precise personal scores without making touch controls overly granular |
| 2026-09-06 | Personal status | Favourite and visited are independent explicit controls; visits also imply visited | Supports unvisited recommendations and direct corrections without overloading collection state |
| 2026-09-06 | Deletion | Place deletion requires UI confirmation and removes attached personal records; bootstrap records receive tombstones | Prevents deleted bundled records from reappearing after refresh |
| 2026-09-06 | Map layout | Evaluate floating drawer, split sidebar, and bottom-sheet variants over one shared API/view-model | Presentation experiments must never fork product behavior or create browser-only data |
| 2026-09-06 | Map tiles | Use a no-key OpenStreetMap baseline during the experiment | CARTO showed an API-key requirement; production tile strategy remains an explicit performance task |

## Open decisions

| Question | Needed by | Evidence/owner |
|---|---|---|
| Exact delivery deadline, if any | Roadmap scheduling only; not core behavior | Andy, optional |
| Main-account behavior supported by the Tencent/OpenClaw integration | WeChat proof of concept | Plugin experiment |
| EU VPS vs Singapore/Japan | Travel deployment | One-week measured pilot |
| Final map layout among the three implementation branches | Before UI component extraction | Andy after visual review |
| Long-term database/API host after WeChat PoC | Before 24/7 deployment | Auth, latency, and operating-cost prototype |
| Desired monthly infrastructure/model budget | Before cloud provisioning | Andy |
