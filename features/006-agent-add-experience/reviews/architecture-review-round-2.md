# Agent Add 体验与 Creator Import 收缩架构评审 (第 2 轮)
- 日期: 2026-09-24
- 评审方式: subagent
- 结论: 需修改
## 发现项
- [一般] `模块与接缝` 第 18–20 行：单一 `present(result)` 接口和业务成功结果已经闭合，但 union 仍没有 operation-level failure（至少 dependency/unavailable，以及 expired 以外需要面向用户的错误类）。`failed-no-write` 是 confirm 的终端业务结果，不等于 operation 执行失败；而当前 Router 正是在 `catalogIntakeFailure` / `intakeStateConflict` 中持有这些中文渠道文案。因此“Router 只选择 presenter”仍无法按这个接口实现。 → 把需要显示给微信用户的 operation failure 映射也加入 `CatalogIntakeConversationResult` 的闭合分支（可是有限、脱敏后的 `temporarily_unavailable | request_failed | state_conflict` 等渠道状态），或在架构中显式保留另一个闭合 error presenter 接口；两种情况都应让 Router 不再持有微信文案。
- [一般] `测试与发布门` 第 43 行：Review 的 loading、signed-out、error、empty、list 五态 render contract 已补齐，但第 1 轮要求的可操作与可访问性语义仍未进入验收接口：empty 的 Add CTA、loading 的 `aria-busy`/live region、error 的 alert 与 retry 都可在“五态有渲染”但用户无法操作／辅助技术无法感知时被误判通过。 → 在同一 render contract 中显式锁定 empty 的 Add CTA、signed-out 的 Owner-login CTA、error 的 retry + alert，以及 loading 的 `aria-busy` + live status；无需扩大截图数量。
