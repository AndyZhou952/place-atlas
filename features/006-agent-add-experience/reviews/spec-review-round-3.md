# Agent Add 精简呈现与使用手册规格评审 (第 3 轮)
- 日期: 2026-09-24
- 评审方式: subagent
- 结论: 需修改
## 发现项
- [一般] `Acceptance Criteria` 4–7: 普通 preview 被要求硬性不超过 900 code points，同时“必填确认字段”又永不截断，但本节没有像候选回复一样给出 title/address/area/reservation/unknown/warning 的显示上限和裁减规则。上游 Add DTO 允许 title 200、address 500、reservation 多个最高 500 字段，因此合法 preview 可确定性超过 900，第三方无法同时满足两条验收标准。 → 为每个可见字段定义含 `…` 在内的硬上限、裁减优先序和长内容的网页查看提示，或放宽/分类定义上限；再用所有字段取最大合法值的 fixture 证明上限必然可达。
- [一般] `Message Design` 118–119 与 `Testing Decisions` 130: 390px 截图门已补上，但“等价微信聊天容器”尚未约束为直接渲染生产 presenter 的原始 `replyText`；实现可以重新手写文本、为不同 fixture 注入专用换行/CSS，仍然产生看似合格的截图。这不满足 hf-ui-design 对用户可感知改动的真实渲染闭环。 → 要求 harness 只接收生产 presenter 返回的完整 `replyText`，以固定 390px viewport、固定中性聊天气泡样式和同一换行规则在真实浏览器中渲染；禁止 scenario-specific CSS/重写文本，并在截图证据中记录 viewport、输入 fixture、原始 reply digest 及 horizontal-overflow 测量。
