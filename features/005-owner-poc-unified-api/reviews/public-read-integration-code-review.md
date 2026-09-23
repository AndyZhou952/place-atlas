# Public Read Integration 代码评审（第 1 轮）

- 日期: 2026-09-21
- 评审方式: subagent
- 固定点: `e7b4e06f36dc829edce0456869ae866acae076f3`
- 被评快照: 固定点加 2026-09-21 当前未提交工作区（`HEAD` 仍等于固定点）
- 范围: public display Application/D1/media migration、Items/Personal/Journal/Media GET responders/routes、browser API、WebMCP 与 Public Read seam 的完整闭环
- 结论: 需修改

## Standards

- [一般] `apps/web/product/application/media/media-write.test.mjs:19-102`：新增 `displayId` 后没有同步既有 attach 回归测试的确定性依赖和期望值；评审者重跑 41 项相关测试时此项失败（40 pass / 1 fail），随机 UUID 直接出现在实际 metadata。→ 给测试注入独立、确定性的 `displayIdSource`，同时把 `displayId` 纳入持久化断言；修复后重跑完整 media read/write 回归集。
- [一般] `apps/web/app/api/items/[id]/personal/route.ts`、`apps/web/app/api/media/[id]/content/open-visit-media-response.test.mjs`、`apps/web/features/atlas/public-read-client.ts`、`apps/web/lib/server/application/media/public-media-display-migration.test.mjs`、`apps/web/lib/server/application/server-atlas-application.ts`、`apps/web/product/application/media/media-operations.ts`、`apps/web/product/application/public-display/public-display-operations.test.mjs`、`apps/web/product/application/public-display/public-display-operations.ts`：`oxfmt --check` 报告 8 个本轮范围文件未格式化。→ 对这些文件运行仓库 formatter 后复查；不要把格式修复混入业务改动以外的文件。
- [一般] `apps/web/lib/server/application/media/d1-visit-media-display.test.mjs:6`、`apps/web/lib/server/application/media/public-media-display-migration.test.mjs:11,29`、`apps/web/lib/server/public-read/public-read-manifest.test.mjs:12,45,142,219`、`apps/web/product/application/media/media-display-read.test.mjs:26,65`、`apps/web/product/application/public-display/public-display-operations.test.mjs:29,65`：全仓 `npm run lint` 的既有 `no-floating-promises` 基线仍失败，而且这些新测试又新增了同类错误。定向 source lint 无其他问题，但仓库标准门不能记为绿色。→ 按仓库已采用的 `void test(...)` 形式修复本轮新增项，并单独处理/记录存量 lint 基线。

## Spec

- [严重] `apps/web/app/api/inbox/route.ts:9-11`、`apps/web/app/api/inbox/list-import-jobs-response.ts:8-17`、`apps/web/app/api/nearby/route.ts:9-13`、`apps/web/app/api/nearby/nearby-atlas-items-response.ts:39-59`：Public Read v1 只批准六个读取 operation，未知读取必须在 Application/D1/R2 前失败关闭；但 `/api/inbox` 仍匿名执行 `import.list` 并直接返回含 `sourceRef/creatorName/message` 的领域对象，`/api/nearby` 也在未经过 Public Read manifest 或 Owner credential 时执行 Application。→ 在发布前关闭这些非 allowlist GET：私有读取须先验证 Owner，若确需公开则先更新已确认 spec/ADR 并建立闭合 projector 与 route-level preauthorization tests；不能继续靠 HTTP GET 自动公开。
- [严重] `apps/web/features/atlas/public-read-client.ts:81-101`、`apps/web/features/atlas/use-atlas-view-model.ts:441-481`、`apps/web/app/api/media/[id]/route.ts:11-29`、`apps/web/product/application/media/media-operations.ts:251-270,293-303`：公开读取把 opaque `displayId` 放入浏览器 `VisitMediaRecord.id`，但登录后的 caption/delete 又把该值提交给仍按内部 `id` 查找的 `media.caption`/`media.delete`。页面刷新后，对已有照片的改说明和删除都会稳定返回 `not_found`；评审者用内存 adapter 实测两个操作均失败。→ Owner mutation 也应以 opaque display ID 为输入并在授权后通过 `findByDisplayId` 解析，或提供不向匿名/客户端泄漏内部 ID 的等价 owner-only 映射；增加“公开读取 → Owner 登录 → caption/delete → 刷新”的闭环 contract。
- [一般] `apps/web/features/atlas/atlas-browser-operation-catalog.ts:79-87,165-188`、`apps/web/app/api/media/route.ts:6-10`：legacy `/api/media` GET 已从 route 关闭，但生成的公开 capabilities 文档仍宣称 `list_visit_media GET /api/media?visitId=...` 可用，且 catalog 测试继续锁定这个失效契约；真实调用只能得到 method-not-allowed。→ 从 capabilities 移除该 legacy read，或把能力显式映射到经过 Public Read projection 的可用读取契约，并加入 capabilities-to-route smoke test。

已核对并通过的规格要点：Items/Personal/Journal/Media 的新公开 responders 在已批准 operation 上均先授权再调用 Application/R2；projector 为逐字段闭合 DTO，sentinel/object key/原文件名/hash/内部 media ID 未从匿名 JSON 恢复；`media.openDisplay` 仅按 opaque `display_id` 查找，默认生产 ID 由独立的 `crypto.randomUUID()` 生成且不等于 internal ID/object key；`0005_public_media_display_id.sql` 在已有媒体时于 schema 变更前失败关闭；公开媒体仅允许 JPEG/PNG/WebP/GIF，并返回固定 public cache、无 filename 的 inline disposition、无 ETag/content-length。

## 验证证据

- `git rev-parse --verify e7b4e06`：固定点有效；`HEAD` 等于固定点，评审读取固定点到当前工作区的 tracked/untracked 全量范围。
- 相关 Application/D1/migration/manifest/routes/browser/WebMCP/media regression：41 项中 40 通过、1 失败；失败为 `media-write.test.mjs` 未同步 `displayId`。
- opaque display ID mutation probe：`media.caption` 与 `media.delete` 以公开 `pm_*` ID 调用时均返回 `not_found`。
- `npm run typecheck`：通过。
- 定向 `npx oxlint ...`：通过；`npm run lint`：全仓失败，且含本轮新测试的 `no-floating-promises` 新增项。
- 定向 `npx oxfmt --check ...`：失败，报告上述 8 个本轮文件。
- `npm run build:owner-poc`：通过；产物 route table 含预期 Public Read routes，但构建成功不替代运行时授权/契约门。

本轮没有修改被评代码；只新增此评审结论。上述严重/一般发现全部关闭前，不得勾选 T-02/T-04，也不得部署公开 owner-poc。
