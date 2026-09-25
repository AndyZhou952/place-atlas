# 规格 — 地点自动补全与 Nearby 诊断

## Problem Statement

Owner 在 Web 或微信用餐厅名发起 Add、并从 Google Places 候选中选择了明确分店后，系统仍可能因为 durable geocoder 返回 `no_match`，要求 Owner 再次填写餐厅名、Area 或地址。该提示与事实矛盾：原始 query、候选 Place ID、瞬时名称和地址已经存在；重复输入也未必让 OSM 收录该商户。Web 把同一问题呈现为三个醒目的必填式输入框，微信则进入重复的 clarification 循环。

Add 的评分和预约事实也没有形成完整的自动补全体验。现有 Catalog Intake schema 已有 Tabelog 与 reservation snapshot，但 Web 在 select 时固定提交 `unknown`，生产 Research Relay 仍关闭；DeepSeek 当前只适合整理受限 proposal，不能凭模型生成地址、坐标、评分或预约事实。因此“自动补全”必须区分立即可修的控制流缺陷和需独立安全门的联网 research 能力。

Nearby 的“池袋”返回 `dependency_failure` 文案，而不是正常的 `not_found`。当前 Owner Worker 通过私有 Route Sidecar 调用 Google Geocoding 与 Routes；若 Sidecar 的 `GOOGLE_MAPS_API_KEY` 只允许 Places API (New)，任意街区都会解析失败。UI 又建议用户改写地址，错误地把 provider 配置故障归因于输入。

## Solution

1. 明确候选被选择后，durable geocoder 的 `no_match` 不再产生“缺少输入”的 clarification；系统直接生成 preview，保留 Owner query 的 title proposal，并把地址／坐标标为 unknown、结果限定为 `needs_review`。真正存在多个 durable location 候选时才要求澄清。
2. Web 与 Agent 复用同一 `catalog.intake.select` 行为。Web 候选步骤只要求选择候选；名称、Area、地址等手动修正收进可选的渐进披露区，不作为生成 preview 的门槛。微信不再要求重复发送已有店名。
3. Preview 在两端明确展示位置、Tabelog、预约三类事实的 `known / unknown / unavailable` 状态；unknown 不伪装成完成。Owner 可以确认保存为 Review Candidate，之后补证据；没有合法坐标时不能进入公开地图或 Nearby。
4. **本轮 release 不交付自动 Tabelog／预约 research。**本轮只保证 Tabelog、预约和位置事实缺失时诚实显示 unknown，并允许保存为 Review Candidate。自动联网补全另立后继 **ENRICH-01**：复用 `DurableGeocoderPort` 和受控 `WebResearchPort`，只接收带来源和时间的 typed proposal。DeepSeek／OpenClaw 可编排搜索与抽取，但不能决定身份、权限、坐标或直接发布；D-P06 Research Relay 未通过安全与部署门前保持关闭。
5. Nearby 保留 Google Route Sidecar 的确定性事实边界。先以脱敏诊断矩阵确认失败类别；只有命中 API disabled／restriction denied 时才修改 credential。目标部署使用两个独立 key：Owner Worker 的 `GOOGLE_PLACES_API_KEY` 只允许 Places API (New)；Route Sidecar 的 `GOOGLE_MAPS_API_KEY` 只允许 Geocoding API 与 Routes API。生产 smoke 必须证明“池袋”解析为东京池袋位置并继续进入 Routes，而不只是消除 `dependency_failure`。
6. Nearby UI 分开呈现 `not_found` 与 `dependency_failure`：前者提示补充城市或完整地址；后者明确“位置服务暂不可用，尚未检查收藏”，只提供重试，不建议改写输入。

## User Stories

1. As the Owner, I want selecting a clear restaurant candidate to continue automatically, so that I do not retype facts the system already has.
2. As the Owner, I want Web and WeChat to use the same Add state machine, so that channel choice does not change correctness.
3. As the Owner, I want missing external facts shown honestly in preview, so that I can save a Review Candidate without polluting the public map.
4. As the Owner, I want optional manual corrections available without blocking the normal path, so that I can fix rare provider mistakes.
5. As the Owner, I want “池袋” and other Japanese neighborhood names resolved by the Nearby location service, so that saved places can be checked from natural location hints.
6. As the Owner, I want provider outages distinguished from bad input, so that I know whether retrying or refining the address can help.

## Implementation Decisions

- The immediate Add hotfix changes Product Core semantics: `DurableGeocoderProposal.status === 'no_match'` is valid unknown evidence, not missing Owner input. `ambiguous` remains the only geocoder-driven clarification state.
- Candidate selection and durable evidence remain separate trust boundaries. Google transient name/address remain response-only and are not copied into D1, sent to DeepSeek, used to seed a non-Google map, or relabelled as Owner assertion. Only Place ID remains durable under the current Google policy gate.
- A preview with unknown location can only confirm as `committed_needs_review`; Catalog publication rules remain authoritative.
- The Web candidate screen uses progressive disclosure: radio selection and one primary action first; optional correction fields are collapsed by default, have persistent labels, and retain current values across retry. Loading, empty, provider error, preview, conflict and success remain explicit states.
- Existing visual direction is retained: Japan Atlas warm editorial interface and current design tokens; no new design system. `DESIGN_VARIANCE=1`, `MOTION_INTENSITY=1`, `VISUAL_DENSITY=2`.
- Tabelog and reservation automatic lookup are not implemented by inventing a prompt inside React or OpenClaw. They require the existing typed research port, source allowlist, budgets, provenance, response-loss/idempotency handling and D-P06 security gate.
- 本轮评分来源只允许既有 Tabelog snapshot；没有通过 research/Owner assertion 得到可靠分数时显示 unknown。不得读取、展示或持久化 Google rating；该能力仍遵循 Feature 005 的延期决策。
- Category and recommended dish remain a later schema extension; this feature must not overload Tabelog, reservation or description fields.
- Nearby does not infer the Owner's location from matching saved restaurants. Location resolution stays request-specific and provider-backed.
- Secrets are never returned in diagnostics. A failed upstream authorization maps to stable `dependency_failure`; deployment evidence records only API enablement names and redacted result classes.

### Provider outcome contract

| Boundary | Outcome | Product result |
|---|---|---|
| Google Places discover | no candidates | empty/refine query；不创建 preview |
| Google Places discover | unavailable/rate limited | retryable `AddError.code=dependency_failure`；不写入 |
| Google Places discover | malformed response | non-retryable `AddError.code=dependency_failure`；不写入 |
| Google Places select refetch | unavailable/rate limited | retryable `AddError.code=dependency_failure`；不写入 |
| Google Places select refetch | malformed response, obsolete/not-found identity or identity mismatch | non-retryable `AddError.code=dependency_failure`；不写入 |
| Durable geocoder | resolved | preview with durable location evidence |
| Durable geocoder | ambiguous | clarification with area/address correction option |
| Durable geocoder | no_match, unavailable or rate limited during select | preview with unknown location plus `needs_review`; `unavailable/rate_limited` additionally derives `provider_unavailable` warning |
| Research disabled/no observation | preview with Tabelog/reservation unknown; no provider warning for intentionally disabled research |
| Research enabled but unavailable/rate limited | preview with unknown or retained stale snapshot plus `provider_unavailable` warning |
| Confirm identity refetch | same durable identity but evidence changed | `status=conflict` with a new preview；不写入 |
| Confirm identity refetch | provider unavailable, rate limited, malformed response or obsolete/not-found identity | `status=failed_no_write, reason=dependency`；不写入 |
| Confirm identity refetch | durable identity changes | `status=conflict` with a new preview containing the changed identity；不写入 |
| Confirm publish | publisher returns a closed no-write outcome | `status=failed_no_write` with the publisher's closed reason；不写入 |
| Confirm publish | unexpected dependency exception before a closed publish outcome exists | retryable `AddError.code=dependency_failure`；不写入 |

`unavailable` is not a new persisted Tabelog/reservation union member. Web and WeChat derive it from `unknown`/retained stale evidence plus the closed `provider_unavailable` warning.

### Nearby diagnostic contract

- Diagnostic evidence may record only endpoint/SKU name, quota decision, HTTP class and normalized provider result class; it must not record key material, raw query, coordinates, provider body, Owner identity or Catalog results.
- Covered classes: missing secret, API disabled/restriction denied, quota exhausted, DNS/redirect/transport failure, upstream 4xx/5xx, malformed response and normal zero results.
- Only API disabled/restriction denied authorizes the key/API runbook. Missing secret restores the secret binding; quota exhaustion follows the budget runbook; malformed responses fail closed and require adapter investigation.
- Nearby never automatically retries provider egress. Retry is an explicit Owner action; every retry performs a new budget/quota reservation, and a failed provider call does not refund the prior reservation. The hard cap therefore cannot be bypassed by diagnostics or UI retry.

## UI Design

- Candidate step hierarchy: chosen place → `Check details` primary action → collapsed `Correct details` disclosure → Cancel. The current red clarification bar is shown only for real identity/location ambiguity.
- Preview groups facts as `Place`, `Location`, `Restaurant facts`, and `Warnings`; it shows Tabelog and reservation even when unknown. Evidence detail remains secondary disclosure.
- Nearby dependency failure copy says the provider is unavailable and that no saved places were checked; it retains the location hint and provides a 44×44px retry action.
- No new cards, gradients, decorative badges or animation. Existing typography, borders, colors and focus tokens are reused; mobile width 390px must have no horizontal overflow.
- `Correct details` exposes native disclosure semantics with `aria-expanded` and `aria-controls`; labels remain persistent and any validation message is connected through `aria-describedby`.
- Select/enrichment loading, error and success are announced through the existing polite live region; the primary action is disabled while pending and retains a visible text reason. After each response, focus moves to the stage heading; error retry returns focus to the actionable control rather than the page root.
- Candidate radio controls, disclosure, links and actions remain keyboard operable with visible focus and at least 44×44px targets. Every transient Google candidate container retains a clear, accessible and unobscured `Google Maps` attribution next to the content it attributes.

## Testing Decisions

- Highest test seam: shared `catalog.intake.discover → select → preview → confirm` contract, run through both Browser adapter and signed Agent gateway.
- Regression fixture reproduces `讃岐うどん大使 東京麺通団` semantics: one selected Place ID, durable geocoder `no_match`, no owner fields. Expected output is `preview_ready` with title proposal and unknown location, never `clarification_required`.
- Preserve negative tests: multiple durable matches still clarify; missing/expired session, wrong ordinal, replay, conflict and provider failure retain closed outcomes; Google transient address never appears in persisted session, preview evidence, receipt, logs or Leaflet data.
- Browser and signed Agent contracts cover every row of the provider outcome table and require byte-for-byte equivalent result class, retryability and no-write semantics.
- Browser rendering at desktop and 390px proves optional corrections are collapsed by default, `aria-expanded/aria-controls` are correct, labels/errors/live announcements/focus transitions work, all targets are at least 44×44px, and preview shows unknown Tabelog/reservation without requiring input. Automated accessibility checks and visual review must cover loading, clarification, dependency error, preview and success.
- Candidate rendering keeps `Google Maps` attribution visible and accessible in the same candidate container; contracts continue to prove transient Google name/address do not enter D1, DeepSeek prompt, receipt, logs or Leaflet.
- WeChat presenter test proves `select 1` returns preview/needs-review language and never repeats “Add a restaurant name, area, or address”.
- Nearby adapter tests distinguish `ZERO_RESULTS → not_found` from missing secret, `REQUEST_DENIED`/API disabled/restriction, quota exhaustion, redirect/DNS/transport, upstream failure and malformed payload without leaking provider bodies.
- A fixed product fixture must resolve `池袋` to the expected Tokyo location, pass a verified saved Ikebukuro item into Route Matrix, and return that item as a Nearby result. Ambiguous or not_found does not pass this fixture. A separate production Sidecar smoke proves the credential/API path resolves `池袋` and reaches Routes after the diagnosed configuration fix; it does not replace the deterministic product fixture.
- Full typecheck, lint, format, architecture fitness, provider policy tests and production build remain release gates.

## Out of Scope

- Persisting Google Places address/rating/coordinates into the Leaflet/OSM Catalog.
- Letting DeepSeek invent or self-confirm identity, coordinates, Tabelog score, reservation facts, access rights or publish decisions.
- Enabling D-P06 Research Relay without its independent threat review, secret/tunnel setup, budgets and rollback evidence.
- Claiming ENRICH-01 automatic Tabelog/reservation completion as part of this release; it remains a separately reviewed successor.
- Category/recommended-dish schema, Screenshot-to-Add, Record, bulk enrichment and catalog-derived location inference.
- Replacing Leaflet with Google Maps or changing the public map provider in this hotfix.

## Further Notes

- Google Places permits durable Place ID storage but restricts caching/exporting other Places content and use with non-Google maps; the current separation remains fail-closed.
- Public Nominatim remains user-triggered, cached, attributed, provider-switchable and capped at one request per second for the whole application.
- The likely production Nearby configuration fix is a distinct Route Sidecar key/API restriction, not widening the Owner Worker Places key; the change is performed only after the redacted diagnostic class confirms that branch.
- 用户确认: 2026-09-24（确认“不重复手填、Web/微信一致、Nearby 池袋真实可用”的本轮边界；自动 Tabelog／预约 research 继续受 D-P06 独立门约束）
