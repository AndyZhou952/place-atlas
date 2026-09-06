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

## Open decisions

| Question | Needed by | Evidence/owner |
|---|---|---|
| Exact delivery deadline, if any | Roadmap scheduling only; not core behavior | Andy, optional |
| Main-account behavior supported by the Tencent/OpenClaw integration | WeChat proof of concept | Plugin experiment |
| EU VPS vs Singapore/Japan | Travel deployment | One-week measured pilot |
| First 30 source items and permission to use uploaded/local media for evals | Data pilot | Andy |
| Long-term database/API host after WeChat PoC | Before 24/7 deployment | Auth, latency, and operating-cost prototype |
| Desired monthly infrastructure/model budget | Before cloud provisioning | Andy |
