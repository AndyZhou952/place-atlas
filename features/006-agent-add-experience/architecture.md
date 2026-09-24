# 架构 — Agent Add 体验与 Creator Import 收缩

- 日期：2026-09-24
- 对应规格：[`spec.md`](./spec.md)
- 状态：confirmed；第 3 轮独立架构评审通过
- 用户确认：2026-09-24

## 产品架构增量

本增量继续遵守模块化单体、唯一 `AtlasApplication` 与 `Channel/UI → Application Operations → Domain → Ports`。Catalog Intake 的发现、候选、preview、confirm、幂等和 evidence 契约不变；只在 Conversation Coordination 增加微信专用只读投影。Web 的 Review 页面仍消费既有 Review Candidate operation，不获得发布决策。

同时正式撤回当前 `ImportJob`：它只有 creator/profile 排队实现、没有 collector，也不是现实 Add 场景。`Acquisition & Review` 仍表示“外部线索先成为 proposal/evidence，不能直接发布”的逻辑边界，但当前没有通用后台采集队列。未来 Screenshot-to-Add 必须复用 Catalog Intake 确认链，若确需异步任务再以新证据立项。

## 模块与接缝

| 模块／接缝 | 小接口 | 隐藏内容与约束 |
|---|---|---|
| `WechatCatalogIntakePresenter`（Conversation） | `present(result: CatalogIntakeConversationResult): string` | 以闭合 union 覆盖 candidates、no-candidate、clarification、preview、conflict、三种 success、cancel、expired、failed-no-write，以及 validation/auth/not-found/state-conflict/dependency/unavailable 等 operation failure；隐藏 allowlist、稳定行序、Unicode code-point 裁减、warning 优先级和总长上限 |
| `CatalogIntakePreviewPresenter`（现有 Web） | `presentCatalogIntakePreview` | 完整 evidence、坐标、license、时间和来源；本增量不删字段 |
| `ProjectCommandRouter` | `/jpmap add` structured output → `replyText` | 只选择对应 presenter；不重做 Add policy，精确命令不调用模型 |
| `ReviewWorkspace`（Web View/MVVM） | existing review-candidate state/actions | 只呈现 Owner 候选五态；不包含 creator form、collector status 或 import jobs |
| Browser/WebMCP/API composition | existing Catalog/Review operations | 删除 `import.*`、`queue_creator_import` 和 `/api/inbox`; 不提供兼容旁路 |
| Published D1 schema | existing migration manifest | `import_jobs` 成为未使用兼容表；不 drop、update、delete 或改写已发布 migration |

## 关键流程

1. **微信 Add**：router 调用既有 `catalog.intake.*` → 收到结构化候选/preview/outcome → 微信 presenter 以闭合 allowlist 生成 bounded `replyText` → OpenClaw 原样转发。Web 仍从同一结构化结果生成审计详情。
2. **警告与冲突**：presenter 按 spec 固定优先级选择最多三条；confirm conflict 明示零写入并显示新版 confirm/cancel。任何被折叠 evidence 可在 Web Owner preview 查看。
3. **Review**：`committed_needs_review` 经现有 Catalog 写入 Owner candidate → Owner 登录后的 Review 页面读回；Public Read、Map 与 Nearby 的 verified 集合门继续排除它。
4. **旧入口退役**：UI、browser client/catalog、WebMCP、route、server composition 和 product operation 同一变更集删除 Creator Import；D1 migration/schema 不随代码退役。

## 数据与不变量

- 微信消息只投影结构化结果，不持久化副本；裁减按 Unicode code points，命令和必填字段行不可丢失。
- `CatalogIntakePreview`、receipt、session、identity、Review Candidate 与 Catalog revision 均不改变 schema 或生命周期。
- `import_jobs` 既有 schema、行数和 payload 在升级前后逐字节不变；运行时代码不再读写它。
- User Manual 只描述当前可执行 contract；示例由真实 parser fixture 验证，禁止 secret-shaped 内容。

## 测试与发布门

- Router/presenter contract：精确文本、全部状态、allowlist 负测、字段与总长边界、OpenClaw 原样转发。
- 390×844 production-presenter 聊天 harness：三候选、preview、warning conflict、success、failed-no-write；保存 SHA-256、长度和 overflow 指标。
- production React/CSS 浏览器门：render contract 覆盖 Review 五态，并锁定 loading 的 `aria-busy` + live status、signed-out 的 Owner login CTA、error 的 alert + retry CTA、empty 的 Add CTA、list 的可操作候选；Owner committed-needs-review read-back，匿名/Map/Nearby 隐藏；desktop 与 390px list 及至少一个 empty/error/signed-out 截图。
- 架构适应度：无 `import.*` operation、capability、route、composition 或 product owner；Review operation 仍完整。
- migration 门：已发布 checksum 不变、危险 SQL 负测、含 sentinel `import_jobs` 行的完整 packaging/build/upgrade smoke。
- 回归：typecheck、lint、全量 tests、build；不需要新 secret、migration 或部署配置。

## ADR / 文档更新

- 更新 `CONTEXT.md` 与 product/docs architecture：撤回当前 `ImportJob`／creator collector 能力，保留 Acquisition & Review 的 proposal-only 边界。
- 新增决策记录：现实建档主链是 Catalog Intake + Review Candidate；遗留表以兼容方式保留。
- 新建低优先级 Screenshot-to-Add backlog issue；本轮不增加图片 ingestion、模型 prompt、route、operation 或 schema。
