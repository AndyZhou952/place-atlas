# 004 OpenClaw × Japan Atlas PoC 规格评审（第 3 轮）

- 日期: 2026-09-13
- 评审方式: subagent
- 结论: 需修改

## 发现项

- [一般] `spec.md:70,78,88-94,120-121`: 第 2 轮要求的状态×迟到事件表已经覆盖 `resolving_place`、`capturing`、`paused`、`ready_to_commit`、`committing/recovery_required` 与 `committed`，但状态模型还声明了 `cancelled`、`expired` 和 `abandoned`，表却在声称“未处理事件按以下状态表产生唯一外部结果”时漏掉这三个状态。旧 session 被取消、过期或放弃后收到迟到文字／图片或原 event 重投时，第三方仍无法判定应返回 closed/expired/abandoned receipt、允许明确新建 capture，还是恢复旧 session。→ 补齐三个状态的唯一外部结果，并区分“旧 event 重投重放旧结果”和“新的显式开始记录可建立新 session”；把对应 terminal-state late-event fixture 纳入 Capture/幂等验收。
- [建议] `spec.md:58-59`: Core 已明确不解释或比较 confidence，resolver adapter 通过确定性规则直接产出三态，因此下一行仍写“达到既定置信门槛”是残留且未定义的旧表述。→ 改为“只有 resolver 返回 `resolved` 且规范地址与坐标齐全才能继续”，避免后续实现重新引入 Core confidence threshold。
- [建议] `progress.md:12,16` 与 `product/assumptions.md:A-19,A-21`: 假设台账和下一步正确区分了用户确认的 10～15 分钟产品范围与待确认的 15 分钟精确上限，但进度第 12 行仍简写成“用户确认约 15 分钟”。→ 将进度表述同步为“用户确认 10～15 分钟范围；15 分钟硬上限待最终确认”，避免恢复会话时误读确认状态。

## 第 2 轮发现闭环

- resolver confidence：Core 已禁止解释/比较供应商或模型 confidence，adapter 只产出 `resolved | ambiguous | unresolved` 并由 contract fixture 约束；未校准数值问题已关闭，残留“置信门槛”措辞见建议。
- route freshness：PoC 明确不跨请求缓存，只有当前请求现场成功结果为 `fresh`，旧结果为 `stale`，失败/缺失为 `unavailable`；外部行为可验收，已关闭。
- 状态×迟到事件：已对 active、preview、commit/recovery 和 committed 状态冻结唯一结果；但 terminal 的 cancelled/expired/abandoned 仍缺，故一般发现尚未完全关闭。
- `recovery_required` 术语：已改为对外提交状态，并明确只有 `committed | abandoned` 是终态；已关闭。
- Journal 词汇：问题陈述与用户故事已改用 Visit／PlaceAssessment／VisitMedia，`map/journal query` 仅描述查询入口；已关闭。
