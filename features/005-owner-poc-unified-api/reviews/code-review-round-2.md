# Owner PoC 统一应用操作代码评审（第 2 轮）

- 日期: 2026-09-21
- 评审方式: subagent
- 固定点: `e7b4e06f36dc829edce0456869ae866acae076f3`
- 被评快照: 固定点到当前未提交工作区；明确排除三个未跟踪 `.orig` 文件
- 结论: 通过

## Standards

未发现需要修改的 Standards 问题。

- `OwnerPocComposition` 现在把 Web、Agent 以及 `getServerInvocationCoordinator()` 的 application 组合到同一个纯 D1 `atlas_items` CatalogRead；静态地点仅用于 migration/seed evidence，不再作为 owner-poc 运行时 fallback。空库、删 canonical 行、篡改 payload、正常 seed 四类 contract 均证明 Web/Agent 不会分叉。
- Owner 写入口保持“先鉴权、后 handler”的统一 guard。闭合路由清单覆盖 9 条业务写路由、12 个 unsafe methods：assessment/Visit/media 共 7 个 methods 进入 coordinator；inbox、Catalog update/delete 及尚未开放的 Add POST 共 5 个 methods 在 owner-poc 下于解析 body、取得 Application 或访问 D1/R2 前 fail closed。Agent 与登录端点仍是清单中显式、各自受 HMAC/credential 保护的例外。
- Public Read 继续通过闭合 DTO/媒体 display ID 投影；未知读取 fail closed，Owner 私有读取才返回编辑所需内部标识。部署 preflight、D1/R2 bindings、seed/evidence、encrypted secret 边界、按 SKU usage ledger 与 Agent HMAC/scope 未见绕过。
- mutation coordinator 保持深模块边界：统一 `InvocationContext`，只规范化一次后 `executePrepared`，服务端以版本化 canonicalizer 计算权威 digest；D1 claim/lease/takeover/replay/conflict 与业务 SQL + receipt 同 batch 原子提交。媒体上传在 D1 提交失败时清理 staged R2 object，删除在 metadata/receipt 提交后将 R2 失败降为不可达 orphan，重试回放同一成功 receipt。

## Spec

未发现需要修改的 Spec 问题。第 1 轮三个阻断均已关闭：

1. owner-poc Web/Agent/写 coordinator 已统一到 D1 `atlas_items`，四类 canonical-source 行为证据通过。
2. Web 的稳定 mutation ID 已进入 HTTP header；assessment、Visit 与 media 均经统一 coordinator，canonical digest、并发 pending、过期 lease takeover、响应回放、异 payload conflict、原子业务写/receipt 与未 finalize 失败关闭均有 contract 证据。尚未接 coordinator 的 owner-poc 写入口全部显式关闭；补入的 `POST /api/items` 检查位于 Owner auth 之后、body/Application/DB 之前，legacy 环境行为不变。
3. `overallComment` 已进入匿名公开读取模型与详情展示，Owner 可编辑；乐观成功/回滚、receipt 校验、刷新恢复以及真实桌面/移动端截图证据齐全。

未发现越过后续门禁或错误宣称完成：`progress.md` 仍明确说明 T-05 的结构化 `nearby.recommend` 未实现；D-P05 仍为 Proposed，T-06 Google Route Sidecar 在独立安全证据前继续 fail closed。T-07/T-08/T-09/T-11、Add confirm 与 Record 也仍保持未完成/未开放。

## UI / 视觉

- 已独立核对总体评语的桌面刷新截图与 390px 移动编辑截图，并核对 default/error/login/loading/success/refreshed 六态 PNG 与 browser smoke 说明。总体评语保持 warm editorial atlas 的纸张、衬线标题和克制的朱红焦点样式，没有引入突兀的新视觉模式。
- 桌面端公开评语在地点详情中层级清晰；移动端 textarea、Save/Cancel 均未横向溢出，主操作为 44px 触控高度。实现包含显式 label、自动 focus、`aria-invalid`/`aria-describedby` error、`role=alert`、disabled saving 与 polite success output，未见阻断性的可访问性问题。

## 独立验证证据

- focused suite：33/33 通过，exit 0；覆盖 canonical source 四场景、D1 receipt/concurrency/takeover、R2 delete/replay、Public/Owner media read、总体评语 optimistic/UI contract、完整 unsafe route surface、Owner 未认证零副作用。
- 当前最终快照的完整 suite、typecheck、migration check、owner-poc build 均由主任务提供 exit-0 证据；architecture fitness 为 61/61。
- `git diff --check` 通过；secret-pattern 扫描未发现真实密码、API key 或私钥进入交付文件（仅命中校验环境变量是否为字符串的代码）。
- 三个 `.orig` 文件只作为明确排除的未跟踪备份存在，没有纳入本轮结论。
