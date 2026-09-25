# 架构 — 地点自动补全与 Nearby 诊断

- 日期: 2026-09-24
- 对应规格: `spec.md`
- 用户确认: 2026-09-24（独立第 2 轮评审 PASS 后按“继续”进入任务拆分）

## 对齐产品架构

本片对齐 [`product/architecture.md`](../../product/architecture.md) 的 Catalog Intake、Conversation Coordination 与 Decision Support：Web 和微信继续只调用同一组 `AtlasApplication` operations；Catalog 独占 verified／needs-review，Route Sidecar 独占 Google request-only 路线事实。没有新数据库 schema、公开数据源或第二写路径。

## 本片模块与缝

1. **Catalog Intake Module**：保持现有 `catalog.intake.*` 小接口；在内部把 durable geocoder `no_match` 深化为“可预览的 unknown evidence”，只把真正 `ambiguous` 暴露为 clarification。Web/Agent 调用方不复制判断。
2. **Catalog Intake Web Module**：View 只呈现 ViewModel 状态。候选选择是主路径；`Correct details` 是默认折叠的可选 Owner assertion adapter。Preview presenter 继续统一 known/unknown/warning 文案。
3. **Project Command Module**：不新增命令；`/jpmap add select <n>` 原样复用 Catalog Intake outcome，微信 presenter 只压缩展示，不推断事实。
4. **Route Sidecar Module**：固定 Google endpoint transport 在 adapter 内把 upstream 响应归一为闭合、脱敏的私有 `RouteSidecarTransportOutcome`；版本化 service-binding interface 不返回 key、query、坐标或 raw body。该层只负责自己能观察到的 `not_configured | credential_rejected | transport_unavailable | upstream_unavailable | malformed_response`，不拥有 Owner 的 D1 quota 决策。
5. **Nearby Web Module**：只根据闭合的 `not_found`／`dependency_failure` 状态选择可操作文案；不解析 provider body，不推断位置。
6. **Owner Metering 与诊断接缝**：`D1MeteredRouteSidecarClient` 在调用 binding 前原子预留 quota，并只在本层产生 `binding_missing | quota_exhausted`。Sidecar transport 与 Owner metered client 各自向仅运维可见、字段 allowlist 的 `NearbyDiagnosticRecorder` 写入本层结果；Nearby adapter 最终把所有依赖故障统一降格为稳定的产品 `dependency_failure`，详细类别永不进入 Application Operation 或 presenter。

## 核心数据

- Catalog Intake session 不变：仍只持久化 Owner query、Place ID tuple 和服务端状态；Google transient presentation 只存在 discover/refetch 响应。
- `no_match` preview：`titleProposal=owner_query`、`locationEvidence.status=unknown`、`unknownFields` 包含 address/coordinates，并带 needs-review warning。
- Sidecar transport 私有 failure class：`not_configured | credential_rejected | transport_unavailable | upstream_unavailable | malformed_response`；Owner metering 私有 class：`binding_missing | quota_exhausted`。二者都只进入脱敏诊断接缝，跨 Owner 产品接口仍是稳定 `dependency_failure`。
- Tabelog/reservation 本轮仍为既有 `known | unknown` snapshot；`provider_unavailable` 只是 presenter 派生 warning，不新增持久状态。

### Confirm refresh 状态转移

| Preview evidence | Confirm-time refresh | Outcome |
|---|---|---|
| unknown / `no_match` | 再次 `no_match` | 保持同一 unknown evidence 与 digest；一次显式 confirm 直接产生且只产生一个 `committed_needs_review` receipt |
| unknown / `no_match` | resolved | evidence/digest 改变，返回 conflict + 新 preview；不写入 |
| any | ambiguous or durable identity/evidence changed | 返回 conflict/clarification 对应的新 preview；不写入 |
| any | unavailable/rate-limited/malformed/identity refetch failure | `failed_no_write` dependency；不把 `no_match` 冒充为 unavailable |

Catalog Intake 将“有效响应但没有 durable match”视为一次成功且稳定的 refresh，而不是 `providerRefreshFailed`。因此 `select → preview(needs_review) → confirm` 不需要第二次确认；只有证据真实变化才触发 conflict。

## 关键流程

```text
Web/WeChat select
  → catalog.intake.select
  → Place ID refetch
  → durable geocoder resolved | ambiguous | no_match/unavailable
  → preview | clarification | preview(needs_review)
  → explicit confirm
  → stable no_match: one committed_needs_review receipt
  → changed evidence: conflict/no-write
```

```text
Web/WeChat nearby 池袋
  → nearby.recommend
  → private Route Sidecar geocode
  → Catalog verified shortlist
  → private Route Sidecar walking matrix
  → reachable saved places or honest empty result
```

## 测试缝

- 最高接缝是共享 Application Operation：provider outcome 表的每一行都从 Browser adapter 与 signed Agent gateway 进入，并断言相同 result class、retryability 与 no-write 语义。`no_match` fixture 必须完成 `select → preview → 单次 confirm`，只生成一个 Review Candidate/receipt，且 Public Read、Map、Nearby 均不可见。
- Production `ProjectCommandRouter` 与微信 presenter 运行真实 `/jpmap add select 1 → preview → confirm` contract；断言不出现旧的 “Add a restaurant name, area, or address” 文案，也不绕过共享 operation。
- Route Sidecar transport 以 fake fetch 覆盖本层每个 class；Owner metered client 独立覆盖 `binding_missing` 与 `quota_exhausted`。负测证明详细 class、HTTP class、key、query、coordinates、raw body 不进入 Application Operation、Web/微信 presenter、D1/R2 或普通日志。固定“池袋 + verified saved item”贯穿 geocode、shortlist、matrix 与 response。
- UI harness 必须直接驱动 production ViewModel 与 production React/CSS，具名覆盖 loading、clarification、dependency error、preview、success；保存 desktop/390px 截图与 overflow 指标，并产出自动可访问性证据，覆盖 focus、live region、`aria-expanded`、44×44px target 和候选同容器内的 Google Maps attribution。
- 部署 smoke 分两层：私有 Sidecar 证明“池袋”成功 geocode 并触发 Routes；Owner Worker 证明 Web Nearby 返回真实 saved result。证据只记录构建/部署标识、endpoint/SKU、quota decision 与归一化结果 class，不记录输入、坐标、private Catalog facts 或 provider body。

## 横切偏离

- A-52 允许 PoC 暂时复用同一 Google key 的三项 API 权限，但不合并两个 secret 接缝；长期运行前恢复独立最小权限 key。
- 用户触发 retry 才产生新 provider egress；每次重新预留 quota，失败不退款。无自动 retry。
- Google/Nominatim attribution、request-only、固定 endpoint、无 redirect 与 secret 脱敏约束不变。

## ADR 链接

- 继续遵循 [`D-P04`](../../docs/decisions.md)、[`D-P05`](../../docs/decisions.md)、[`D-P06`](../../docs/decisions.md)；本片不接受 D-P06，也不启用 Research Relay。
