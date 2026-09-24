# Agent Add 体验与 Creator Import 收缩架构评审 (第 1 轮)
- 日期: 2026-09-24
- 评审方式: subagent
- 结论: 需修改
## 发现项
- [一般] `模块与接缝` 第 18–20 行与 `测试与发布门` 第 41 行：`WechatCatalogIntakePresenter` 的“小接口”只写了含混合命名的 `presentCandidates/outputPreview/outputConfirm`，没有形成可穷举的输入 union，也没有说明 no-candidate、clarification、cancel 和 operation failure 由谁呈现；但同文又要求 Router “只选择对应 presenter”并对“全部状态”做 presenter contract。按当前设计实现，现有 Router 内的 cancel／失败文案可以继续留在 presenter 之外，导致渠道呈现规则分裂，也无法用一个闭合接口验收规格的候选、preview、冲突、成功、失败与取消。 → 把 presenter 接口定义为覆盖所有 Agent Add 外显结果的闭合 union → bounded `replyText`（或显式列出完整且命名一致的方法集），并明确 Router 只负责解析／编排、不持有微信文案。
- [一般] `测试与发布门` 第 43 行：浏览器门只要求 list 与 empty/error/signed-out 中的任一截图，没有承接已确认规格第 151 行的“Review Candidates 五种状态全部做 contract/render 验证”；这次又同时从共享 ViewModel 删除 Import state，只做一个失败／空态截图不能防止 loading、signed-out 或 error 分支被误删。 → 在架构中增加真实 Review ViewModel/React 接缝的 loading、signed-out、error、empty、list 五态 render contract，并明确 empty CTA、`aria-busy`、live/alert 语义；真实截图范围可继续按规格保持 desktop/390px list 加至少一个非 list 状态。
