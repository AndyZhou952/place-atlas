# 地点自动补全与 Nearby 诊断架构评审（第 1 轮）

- 日期: 2026-09-24
- 评审方式: subagent
- 结论: 需修改

## 发现项

- [一般] `architecture.md:16,23,50,55-57`：`Route Sidecar` failure class 同时列入 `quota_exhausted`，却称其为 Sidecar 内部分类并拟经 service-binding interface 交给 Owner adapter；按 D-P05，quota 必须由 owner-poc 在调用 binding **之前**原子预留，Sidecar 无 D1／预算权威，不能产生该类别。正文也未说明 HTTP class、endpoint/SKU、quota decision 应由哪个模块写入哪条仅运维可见的诊断接缝，直接扩展共用 `GoogleRouteSidecarPort` 容易把 transport 分类变成长期业务接口或误传至产品 DTO。→ 分开两层闭合结果：私有 Sidecar binding 只返回它能判定的安全 transport/provider class，Owner metered client 再加入 `binding_missing | quota_exhausted` 等本层类别；由各责任模块向一个 allowlisted diagnostic recorder 写入规格允许的字段，最后只在 `Nearby` adapter 统一映射为产品 `dependency_failure`。明确这是私有、版本化的 interface 变更，并用负测证明详细类别、HTTP class、key/query/coordinates/raw body 均不会进入 Application Operation、Web/微信 presenter、D1/R2 或普通日志。

- [一般] `architecture.md:13,22,28-36,49`：`no_match → unknown → needs_review` 只闭合了 select，未定义已有 unknown preview 在 confirm-time durable-geocoder refresh 时的状态转移。既有 coordinator 会在 confirm 再调用 geocoder；若实现继续把任何非 `resolved` 都当作 refresh failure，同一个 `no_match` 会新增 `provider_unavailable` warning、制造额外 conflict，用户仍需再次确认，甚至不同入口可能产生不同 digest。→ 在 Catalog Intake 深模块内补 confirm refresh 表：相同 `no_match` 保持同一 unknown/needs-review evidence、不得冒充 unavailable，也不得改变 digest，应由一次显式 confirm 直接进入 Catalog publication 并得到 `committed_needs_review`；真正 unavailable/rate-limited、由 unknown 变 resolved、或其他 evidence 变化分别遵循规格的 warning/conflict/no-write outcome。增加 select→preview→单次 confirm 的 contract，证明只产生一个 Review Candidate/receipt，且 Public Read、Map、Nearby 均不可见。

- [一般] `architecture.md:47-51`：测试缝只要求 Browser/Agent 共享一个 no-match fixture，Sidecar 只在 fake fetch 处覆盖 failure class；它没有承接已通过规格要求的“provider outcome 表逐行 Browser/signed Agent 等价”，也没有真实经过 `ProjectCommandRouter`／微信 presenter 证明 `select 1` 不再回到 clarification。UI 证据仅称“Add disclosure 五态”，未锁定 production ViewModel/operation 输出、具体状态、axe/ARIA/focus、Google attribution 和 390px overflow，手写 harness 也可满足当前描述。→ 把 Application Operation 定为所有 provider 行的最高外部测试缝，并让 Browser adapter 与 signed Agent gateway 逐行断言相同 result class/retryability/no-write；再用 production router/presenter 做真实 `/jpmap add select 1 → preview → confirm` smoke。UI harness 必须直接驱动 production ViewModel 与 production React/CSS，具名覆盖 loading、clarification、dependency error、preview、success，保存 desktop/390px 截图、overflow 指标和自动可访问性结果，并断言焦点、live region、44×44px target 与同容器 Google Maps attribution。

---

# 地点自动补全与 Nearby 诊断架构评审（第 2 轮）

- 日期: 2026-09-24
- 评审方式: subagent
- 结论: 通过

## 发现项

- 无。

## 首轮闭合情况

- Sidecar transport 只拥有其可观察的闭合私有 outcome；Owner metered client 独占 binding/quota 类别；allowlisted 运维诊断接缝与产品 `dependency_failure` 已分层，并有跨 Application Operation、presenter、D1/R2、普通日志的泄漏负测。
- Confirm refresh 已明确把再次 `no_match` 视为成功且稳定的 refresh：unknown/needs-review evidence 与 digest 不变，一次 confirm 只生成一个 `committed_needs_review` receipt；证据变化和真实 provider failure 另走 conflict/no-write。
- 共享 Application Operation 覆盖 provider outcome 表每一行的 Browser/signed Agent 等价 contract；production router/微信 presenter 覆盖真实 select→preview→confirm；production ViewModel/React/CSS harness 固定五态、desktop/390px、overflow 与自动可访问性证据；“池袋”同时具有确定性全链 fixture 和私有 Sidecar＋Owner Worker 部署 smoke。
