# 任务票 — 地点补全与 Nearby 交互收口

- 状态：规格第 3 轮与架构第 2 轮独立评审均已 PASS；本轮只交付“不重复手填、双入口等价、池袋 Nearby 可用”的 PoC 主链。
- 实施纪律：红→绿→重构；Catalog Intake、Owner composition 与 Route Sidecar 的共享面串行汇合；真实 secret、query、坐标、provider body 和私人 Catalog facts 不写入提交或普通日志。

## 当前实现波次

- [x] **T-01 Add `no_match` 单次确认纵切** — Blocked by: None — 在共享 `catalog.intake.select/confirm` 内将 durable geocoder `no_match` 解释为稳定 unknown evidence，而非缺少 Owner 输入；先以 Browser 与 signed Agent 共用 fixtures 复现 `讃岐うどん大使 東京麺通団`，使 select 直接产生 needs-review preview，confirm 再次 `no_match` 时保持 digest 并一次提交唯一 Review Candidate/receipt。provider outcome 表每一行均从 Browser 与 signed Agent 入口断言相同 result class、retryability 和 no-write；保留 ambiguous clarification、真实 evidence change conflict、provider dependency no-write、replay/expiry/CAS 和 Public/Map/Nearby 隐藏门。production `ProjectCommandRouter`／微信 presenter 的 `/jpmap add select 1 → preview → confirm` contract 不得出现旧的重复输入提示。**Owned production:** `product/application/catalog-intake/catalog-intake-coordinator.ts`、必要的 Catalog Intake shared result/preview types、`product/application/conversation/project-command-router.ts`、`wechat-catalog-intake-presenter.ts`。**Owned tests:** 新建/专属 Feature 007 Catalog contract、Browser/signed-Agent outcome-matrix 与微信 router/presenter test files；不修改 Web React 或 Route Sidecar files。

- [x] **T-02 Web Add 渐进披露与状态反馈** — Blocked by: T-01 contract — 让候选选择成为默认主路径，`Correct details` 作为默认折叠、非必填的 Owner 修正区；Preview 按 Place、Location、Restaurant facts、Warnings 展示位置/Tabelog/预约的 known/unknown 状态，不能把未接通的 research 显示为已完成。直接驱动 production ViewModel/React/CSS 覆盖 loading、discover 无候选的 empty/refine-query、clarification、dependency error、preview、conflict、success；pending 时主按钮必须 disabled 且有可见文字原因。完成 desktop/390px 截图、无横向溢出、focus/live region、`aria-expanded/aria-controls`、`aria-describedby`、44×44px 与候选同容器 Google Maps attribution 证据。**Owned production:** `features/atlas/catalog-intake-panel.tsx`、`features/atlas/use-catalog-intake.ts`、`features/atlas/catalog-intake-ui-state.ts` 及其专属样式。**Owned tests/evidence:** 新建/专属 Feature 007 production ViewModel/React/CSS harness、a11y/overflow assertions 与 screenshot artifacts；不修改 Catalog coordinator、conversation router 或 Sidecar files。

- [x] **T-03 Nearby provider 分层诊断与池袋纵切** — Blocked by: None — 在 Sidecar transport、Owner metered client 与产品 Nearby adapter 三层保持闭合结果：Sidecar 只归一自己能观察的 provider/transport class，Owner 层独占 `binding_missing/quota_exhausted`，详细 class 只进入 allowlisted 运维诊断，产品仅得到 `not_found` 或 `dependency_failure`。覆盖 zero-results、missing secret、restriction/API denied、quota、DNS/redirect/transport、4xx/5xx、malformed response 和不泄漏负测；固定“池袋 + verified saved item”贯穿 geocode→shortlist→Routes matrix→saved result。UI 必须分别验证 `not_found` 的 refine-address 文案与 `dependency_failure` 的“尚未检查收藏／重试”文案。provider 不得自动 retry；每次 Owner 显式 retry 都重新原子预留 quota，失败不退款，硬上限不可绕过。**Owned production:** `route-sidecar/google-route-sidecar-transport.ts`、`route-sidecar/route-sidecar-service.ts`、`route-sidecar/route-sidecar-contract.ts`、`route-sidecar/metered-route-sidecar-client.ts`、`route-sidecar/d1-metered-route-sidecar-client.ts`、`route-sidecar/route-sidecar-nearby-adapter.ts`、`route-sidecar/worker.ts`、新增私有 `NearbyDiagnosticRecorder` 接口及 allowlisted/no-op adapters、`product/application/decision/nearby-recommendation-operation.ts` 与 `features/atlas/atlas-screen.tsx` 的 Nearby 双态文案。T-03 负责 Sidecar worker 的 production 接线与 Owner 层测试 composition；不修改 Owner production composition。**Owned tests:** 新建/专属 Feature 007 sidecar transport、worker/diagnostic、Owner metering/retry、Nearby product fixture 与双态 UI test files；不修改 Owner production composition 或部署 config。

- [ ] **T-04 Web／微信／Nearby 集成、部署与 Owner 演示验收** — Blocked by: T-01, T-02, T-03 — 独占串行修改 Owner production composition（包括注入 T-03 已验收的 Owner-side diagnostic/metering adapter）、Owner service binding 接线、部署配置、architecture fitness 与跨模块 E2E；Sidecar worker 的内部接线归 T-03，T-04 只部署已验收产物，不得重写前三票已冻结的模块行为。运行 typecheck、lint、format、全量 tests、architecture fitness、provider policy、production build 与 UI evidence gate；部署私有 Route Sidecar 和 Owner Worker，并记录脱敏构建/部署标识、endpoint/SKU、quota decision 与归一化结果 class。真实主验收固定为三条不可替代链：① Web Add 选候选无需重填并一次 confirm 保存唯一 Review Candidate/receipt；② 真实微信 `/jpmap add ... → select 1 → preview → confirm` 无旧提示且只生成一个 Review Candidate/receipt（cancel 另作负向 smoke）；③ 私有 Sidecar 对“池袋”成功 geocode 并触发 Routes，Owner Worker Web Nearby 返回预先核验的真实池袋 saved item。另验收合法业务空结果，以及 `not_found`／`dependency_failure` 文案分流。**Owned production:** Owner production composition、service binding wiring、deployment/preflight config 与 scripts。**Owned tests/evidence:** 独占 architecture-fitness、跨模块 E2E、deployment smoke、live evidence 与 demo acceptance files。

## 明确后继（不进入本轮 DoD）

- [ ] **ENRICH-01 Tabelog／预约自动研究** — Blocked by: D-P06 accepted + Research Relay production security/deployment gate — 以 source allowlist、预算、provenance、response-loss/idempotency 和 typed proposal 接通真实联网 research；DeepSeek/OpenClaw 只做受限搜索编排与抽取，不决定 identity、权限、坐标或发布。本轮继续诚实显示 unknown，并保留 Owner 可选修正。
- [ ] **B-01 Screenshot-to-Add** — Blocked by: ENRICH-01 stable place enrichment — 从截图识别候选后复用同一 discover/select/preview/confirm 主链；不得恢复 Creator Import 或直接写库。

## 并行与汇合

| 波次 | 可并行票 | 汇合点 |
|---|---|---|
| W1 | T-01、T-03 | 按票内 Owned files 并行；T-03 负责 Sidecar worker production 接线与 Owner test composition，但不触碰 Owner production composition |
| W2 | T-02（基于 T-01 contract） | Catalog Intake Web ViewModel/React |
| W3 | T-04 | composition、部署配置与真实三链验收统一收口 |

所有权冲突时立即停在本票边界：Catalog shared DTO 归 T-01，Sidecar private binding contract 归 T-03，Owner production composition、部署配置、architecture-fitness 与跨模块 E2E 归 T-04。每票测试使用专属新文件；不得在并行波次共同修改聚合 harness。T-04 只做接线与重跑，不改变前三票已验收的产品语义。
