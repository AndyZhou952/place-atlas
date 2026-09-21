# 004 OpenClaw × Japan Atlas PoC 规格评审（第 1 轮）

- 日期: 2026-09-13
- 评审方式: subagent
- 结论: 需修改

## 发现项

- [严重] `spec.md:16,68,75,81,89,105-107`: 规格允许提交过程中出现“Visit 已创建、部分图片已完成”，但没有定义不可恢复的媒体失败、重试耗尽或进程永久丢失后，用户最终会看到完整成功、完整失败、可继续恢复还是可接受的部分成功；也没有定义此时普通地图读取是否能看到半完成 Visit。第三方因此无法判定“部分失败和重启不会造成错误结果”，并与 `product/architecture.md` 的“重复/半写入为 0”质量属性及 30/60 秒收敛预算不闭合。→ 明确一次 capture mutation 的可见提交边界、`recovery_required` 的终态/可执行动作、重试耗尽与人工放弃规则、receipt 的完整/部分/失败语义，以及 D1/R2 已落盘中间状态在普通读取中的可见性；为每种故障注入写出唯一可判定结果。
- [一般] `spec.md:22,59-60,102,124` 与 `product/assumptions.md:A-19`: 用户原话是“步行范围 10～15 分钟”，并未单独确认把上界固定为 15 分钟；“无需换乘电车总行程 30 分钟”也仍是作者建议。当前正文把 15 分钟写成既定要求，而台账把它记为已确认，30 分钟则留在待确认状态，确认层级不一致。→ 把“15 分钟”明确标为待本轮确认的 PoC 默认值或重新询问用户；将 15 分钟与 30 分钟作为两个独立可接受/可调整的决策点，确认后再更新假设状态和边界测试。
- [一般] `spec.md:24,27,62-63,74,122` 与 `CONTEXT.md`、`docs/decisions.md:D-005,D-009,D-012`: 规格用“已有 Visit”作为个人评分展示条件，却没有说明它与 `Effective Visited State = 存在 Visit OR manualVisited` 的关系；现有接受决策又允许单独修改 `PlaceAssessment.overallRating` 而不创建 Visit。这样会出现 `manualVisited=true` 或已有独立评分但没有 Visit 时，数据合法却在 Nearby 被隐藏的歧义；预览中的“评分”也可能被误解为 Visit 自身字段。→ 明确评分仍写入 `PlaceAssessment` 而非 Visit，并确定展示条件究竟是“存在评分且有效到访”、严格“存在 Visit”，还是本特性要修改既有评分写入不变量；若推翻 D-012，必须显式记录替代决策和迁移/兼容行为。
- [一般] `spec.md:47-50,85-89,115` 与 `docs/roadmap.md:APP-02,AGENT-02`、`features/001-agent-ready-core/spec.md:95-96,148`: Write gate 只要求 APP-02 的 message/mutation 幂等、conflict、receipt 与恢复子集，而既有 APP-02 路线项还包含可恢复删除，且 AGENT-02 当前登记为依赖完整 APP-02；本规格又明确把 Trash 排除在外。现在无法判断 004 通过后 APP-02/AGENT-02 是否可标完成、依赖是否被正式改写，或仅完成一个不得关闭路线项的安全子集。→ 明确 004 对每个路线项是“完整交付”“受限 Visit/Media 子集”还是“新能力替代”，同步给出不开放 destructive 时跳过 Trash 是否被接受的决策，禁止用本特性门禁暗示未完成路线项已经完成。
- [一般] `spec.md:33,40,48-49,87,103,113`: “OpenClaw 不能访问 shell 或任意 URL”没有限定为 Atlas 专用 workspace/credential/tool profile，容易被解释为限制整台通用个人 Agent，与用户未来让同一 OpenClaw 承担其他项目的目标冲突；同时，隐藏工具不能代替 Atlas 服务端鉴权。→ 明确禁令只约束 Atlas 会话/工作区和 Atlas credential 的可达能力，还是要求独立 OpenClaw 实例；无论 OpenClaw 全局还拥有什么工具，Atlas API 都必须仅凭服务端验证的 owner、conversation 与 operation scope 失败关闭，并为“通用 workspace 尝试越权 Atlas”增加负面验收。
- [一般] `spec.md:57,61-62,96,101-102,123`: “既定置信门槛”“路线证据过期”“未知/过期事实”没有对应数值、版本化策略引用或供应商无关的可判定状态，导致相同 fixture 可被不同实现分别判为可继续或应澄清。→ 在规格中冻结外部状态机（例如 resolver 必须返回 `resolved | ambiguous | unresolved`，route evidence 必须返回 `fresh | stale | unavailable`）及各状态的用户结果；具体供应商分数可以留给架构，但不得让模型/adapter 自由解释通过门槛。
- [一般] `spec.md:68-73,80,97,104-105`: 规格列出乱序事件测试，却没有规定渠道顺序依据、迟到文字/图片在 `ready_to_commit` 或 `committing` 时的处理，也没有说明 24 小时是从创建、最后活动还是进入 paused 起算，“下一条相关消息”也未定义。→ 明确可信排序键和同序 tie-break、各状态对迟到事件的接受/拒绝/另开补充草稿行为、30 分钟与 24 小时使用的时钟锚点，以及哪些事件会恢复或刷新 session；随后把乱序、边界同刻和过期竞争写成可判定验收。
- [一般] `spec.md:89,107-108` 与 `product/architecture.md:17,98`: Real-data/soak gate 只要求“通过”或“记录”弱网、成功率、p95、重连、人工介入和成本，没有 pass/fail 阈值；因此七天后无论表现多差都可以宣称已完成。上游已给出 RTT 800 ms、10% 失败时 5 秒显示待重试、成功写入 30 秒收回执、网络恢复后 60 秒收敛且重复写入为 0 的预算。→ 直接继承这些预算或显式提出经确认的替代值，并为 soak 的授权成功数、重复数、成功率、p95、最大人工介入和预算上限定义通过标准。
- [建议] `spec.md:7,26` 与 `CONTEXT.md` 的 Journal 词汇约束: “污染真实 Journal”把过渡网页界面写得像持久领域实体，容易让实现者把 capture 状态放入旧 `journal_entries`。→ 改为“写入真实 Visit／PlaceAssessment／VisitMedia”；需要描述页面时只称“Journal 过渡界面”。
- [建议] `spec.md:72,82,106`: 已限定单图 8 MB、单批 4 张和 24 小时保留，但没有限定单个 capture 的累计附件数、累计字节、文字片段数/长度或并发草稿占用；单 owner 也可能因重复投递或误操作造成资源与费用无界。→ 在规格冻结供应商无关的 session/request 配额及超限的 `invalid_input`/可继续恢复行为，具体 Cloudflare 内存和请求体映射留给架构。
