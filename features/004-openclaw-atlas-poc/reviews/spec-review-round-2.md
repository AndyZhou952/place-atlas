# 004 OpenClaw × Japan Atlas PoC 规格评审（第 2 轮）

- 日期: 2026-09-13
- 评审方式: subagent
- 结论: 需修改

## 发现项

- [一般] `spec.md:57-59,63,111` 与 `product/assumptions.md:3,21-23`: 第 1 轮要求的 resolver/route 外部状态已经补齐，但修订同时把 `confidence ≥ 0.90` 和路线缓存年龄 `≤5 分钟`写成强制事实；这两个数值既不是用户已确认内容，也未像 15/30 分钟和 capture quota 一样登记为待确认假设。尤其“归一化 confidence”没有定义校准方法，而既有 D-006 明确不把模型自报 confidence 当概率，因此第三方仍不能证明 0.90 在不同 resolver 间具有相同含义。→ 优先让 resolver contract 直接产出经 contract test 约束的 `resolved | ambiguous | unresolved`，避免核心解释供应商分数；如保留 0.90/5 分钟，则把二者登记为待确认默认值，说明供应商无关的归一化/校准和边界 fixture，并列入规格最终确认项。
- [一般] `spec.md:70,73,75-76,86-88,107,114-115`: 稳定 event ID、单调 sequence 和 30 分钟/24 小时时钟锚点已明确，但“早于当前状态所需位置的迟到内容”仍把 `拒绝、提示重发或显式追加` 三种互不相同的结果交给实现按状态自行决定；规格也没有列出 `capturing`、`ready_to_commit`、`committing/recovery_required`、`committed` 各自收到迟到文字/图片时的唯一行为。这样同一个乱序 fixture 仍可由两个实现给出不同结果并都声称通过。→ 冻结一张最小状态×迟到事件表，例如 capturing 可按 sequence 重排，ready_to_commit 的新内容使旧预览失效并回到 capturing，committing/recovery_required 拒绝修改已绑定 payload，committed 只接受显式回执追加；随后让测试断言这些外部结果。
- [建议] `spec.md:78-80`: `recovery_required` 被称为“三种终态”之一，但下一段又允许它转为 `committed` 或 `abandoned`，术语自相矛盾；本轮新增的不可见 staging、原子 publish、同 ID 恢复、24 小时自动 abandon 和 reconciliation 已足以关闭上一轮严重发现。→ 将三者称为“对外提交状态/结果”，或把真正终态限定为 `committed | abandoned`，避免实现把 `recovery_required` 当不可再推进的 terminal state。
- [建议] `spec.md:7,26` 与 `CONTEXT.md` 的 Journal 词汇约束: 第 1 轮指出的“污染真实 Journal”仍未修改，依然把过渡网页界面写得像持久领域实体。→ 改为“写入真实 Visit／PlaceAssessment／VisitMedia”；仅在描述页面入口时使用 Journal。

## 第 1 轮发现闭环

- capture 半写入与恢复：已补齐不可见 staging、D1 原子 publish、`recovery_required`、重试/放弃、24 小时自动 abandon、孤儿对账及完整可见性要求；严重发现已关闭。
- 用户确认与默认值：10～15 分钟保持已确认产品范围，15/30 分钟分别作为待确认 PoC 默认值写入 A-21；已关闭，但仍须在规格通过后由用户最终确认。
- 个人评分：已明确评分属于 `PlaceAssessment.overallRating`，Nearby 以 `Effective Visited State` 控制展示，不把评分变成 Visit 字段；已关闭。
- APP-02/AGENT-02：已明确只交付 Visit/Media 与 Atlas 服务子集，不能据此把完整路线项标记完成，Trash/destructive 保持范围外；已关闭。
- OpenClaw 边界：已明确同一实例的 Atlas 独立 workspace/credential/tool profile，其他个人助手 workspace 不受限，而 Atlas API 始终服务端鉴权；已关闭。
- session 时钟与保留：30 分钟/24 小时锚点、边界优先级和不续期事件已明确；已关闭。迟到事件的逐状态结果仍见本轮一般发现。
- 弱网、soak 与配额：已继承 5/30/60 秒预算，量化七天脚本、零重复/丢失/半可见/越权、恢复、成本和单 session 配额，并将新增默认值登记为 A-23 待确认；已关闭，仍须用户最终确认。
