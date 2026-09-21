# Owner PoC 统一应用操作代码评审（第 1 轮）

- 日期: 2026-09-21
- 评审方式: subagent
- 固定点: `e7b4e06f36dc829edce0456869ae866acae076f3`
- 被评快照: 固定点到当前未提交工作区；明确排除三个未跟踪 `.orig` 文件
- 结论: 需修改

## Standards

- [一般] `apps/web/lib/server/application/server-atlas-application.ts:43-47`、`apps/web/adapters/agent/owner-poc-agent-composition.ts:7-13`: owner-poc 的 Browser composition 仍以 `verifiedAtlasItems` 作为运行时 fallback，而 Agent composition 使用纯 D1 `atlas_items` adapter；同一部署因此存在两种 CatalogRead 语义，违反已确认的单一 Application Operations / 单一事实源边界，也让典型 Catalog 变化需要同时顾及静态 seed 与 canonical adapter。独立行为探针在同一个空 D1 上得到 `Web=5`、`Agent=0`，已经证明会真实分叉。→ 在中央 `OwnerPocComposition` 中为 Web 与 Agent 注入同一个纯 `atlas_items` CatalogRead；静态 artifact 只允许参与 migration/seed evidence，不得作为 owner-poc 运行时 fallback，并增加同一 D1 经两入口返回同一 Catalog 的 contract test（含 canonical 行缺失/篡改负测）。

其余已审范围未发现新的 Standards 阻断：Owner session/write guard、公开/私有读取门、opaque media display ID、Agent HMAC、seed evidence、分 SKU ledger 与 UI 状态机均保持小接口和 fail-closed；定向测试、typecheck、migration check、diff whitespace 与 secret-pattern scan 的结果见下方证据。

## Spec

- [严重] `apps/web/lib/server/application/server-atlas-application.ts:43-47`、`apps/web/product/application/catalog/catalog-read.ts:10-25`: 静态 seed fallback 违反验收标准 10、14、15 以及 A-31/A-35：`atlas_items` 尚未成为 Web 与 Agent 唯一地点事实源。D1 canonical 行缺失时网页会继续显示仓库中的 5 条地点，而 Agent 不显示；因此不能声称两端读取同一目录，也不能进入 owner-poc 发布门。→ 按上项统一 composition，并用空库、删行、改 payload、正常 seed 四类双入口等价测试关闭该问题。
- [严重] `apps/web/features/atlas/use-atlas-view-model.ts:486-528`、`apps/web/features/atlas/atlas-api-client.ts:151-165`、`apps/web/app/api/items/[id]/personal/update-place-assessment-response.ts:15-41`: Web 生成的 `mutationId` 只用于本地乐观状态，HTTP 请求没有携带 mutation ID；route 直接执行 operation，也没有统一 `InvocationContext`、schema-normalized canonical digest 或原子 claim/write/receipt。重复/响应丢失时无法满足验收标准 16-18 与 T-03，Visit/media 等非幂等写仍可能重复。→ 实现架构中定义的 `InvocationCoordinator`，让浏览器稳定 mutation ID 到达服务端，由服务端唯一 canonicalizer 计算 digest 并返回可重放 receipt；对 assignment、Visit、media 覆盖 response-lost replay 与异 payload conflict。
- [一般] `apps/web/features/atlas/public-read-client.ts:7-11,36-51`、`apps/web/features/atlas/atlas-screen.tsx:594-613`: `PublicAssessmentV1.overallComment` 没有进入浏览器读取模型，页面只有总体评分编辑，没有总体评语输入/展示；底层 PATCH 虽接受 `summary`，刷新后网页仍丢弃该值。这不满足成功定义和验收标准 12 的“总体评论保存并刷新恢复”。→ 给现有暖色详情区增加总体评语的读取、编辑、loading/error/success 与回滚路径，映射公开 DTO 的 `overallComment`，并增加真实保存→刷新测试及相应截图证据。

已确认没有错误宣称完成的门禁：`progress.md` 明确保留 T-05；当前 owner Agent 仍是 `agent.nearby/replyText` 兼容骨架且路线 lookup fail closed。D-P05 仍为 Proposed，owner Worker 无 Google/Foursquare/Transit binding，T-06/T-07/T-08/T-09/T-11 与后续 Add/Record 均未被勾选或宣称交付。

## UI / 视觉

- 已直接核对本轮保留的桌面/移动端 default、error/focus、success PNG 证据及第 3 轮 UI 独立评审：Owner Login 保持 warm editorial atlas、非 modal、44px 触控目标、焦点返回和 `aria-invalid/aria-describedby`，未见方向漂移或视觉硬伤。
- 本轮新增 Spec 发现是总体评语功能缺失；在补齐该交互前，T-10 不能仅凭登录面板截图视为完整的“登录后保存并刷新”验收。

## 独立验证证据

- 固定点有效，完整读取 tracked diff 与全部非 `.orig` untracked 交付文件；`git diff --check` 通过。
- 行为探针：同一空 D1 下 Browser `createCatalogRead(D1CatalogState, verifiedAtlasItems)` 返回 5 条，Agent `createD1OwnerPocCatalogRead` 返回 0 条，稳定复现事实源分叉。
- `npm run typecheck`：通过。
- `npm run migration:check`：通过。
- auth/public-read/owner-poc/architecture/UI 定向 suite 中已执行的 50+ 项全部显示通过；进程最终因仓库已知的测试 open handle 被 `timeout` 终止，未出现 assertion failure，因此不把该次命令记作完整绿色发布门。主任务另有完整 force-exit suite 与 owner-poc build 的 exit-0 证据，但本评审结论不依赖该叙述来豁免上述行为缺口。
- secret-pattern / `.pem` 扫描：未发现凭证明文进入交付文件。
