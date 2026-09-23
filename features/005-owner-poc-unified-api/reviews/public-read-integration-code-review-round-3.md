# Public Read Integration 代码评审（第 3 轮）

- 日期: 2026-09-21
- 评审方式: subagent
- 固定点: `e7b4e06f36dc829edce0456869ae866acae076f3`
- 被评快照: 固定点加 2026-09-21 当前未提交工作区（`HEAD` 仍等于固定点）
- 结论: 需修改

## Standards

- [一般] `apps/web/app/api/items/[id]/personal/route.ts`、`apps/web/app/api/media/[id]/content/open-visit-media-response.test.mjs`、`apps/web/product/application/public-display/public-display-operations.ts`：本轮 scoped `npx oxfmt --check` 失败并明确报告这 3 个被评文件；因此代码门尚未满足仓库格式标准。→ 仅对这 3 个文件执行 formatter，随后重跑同一 scoped format、lint、typecheck、focused tests 与 owner-poc build。
- [建议] `apps/web/app/api/media/[id]/content/owner-media-content-response.test.mjs:12-56`、`apps/web/app/api/private-read-routes.contract.test.mjs:5-23`：新增测试证明 Owner responder 能按 internal ID 返回图片，但没有直接锁定 content route 的 `pm_` 匿名分支与非 `pm_` Owner-auth 分支；当前结论依赖 route 源码审查、通用 Owner guard 行为测试及 responder 测试三段证据。→ 增加 route-level contract，分别证明匿名 internal ID 在 Application/R2 composition 前得到 401、匿名 display ID 只执行 `media.openDisplay`、认证 internal ID 能成功返回字节。

除格式门外，未发现新增 lint、类型或构建问题；命名、分层及错误映射未见会阻断本范围的代码异味。

## Spec

本轴通过，round-2 两个阻断均已关闭：

- `apps/web/app/api/media/[id]/content/route.ts:11-25` 对非 `pm_` internal ID 先进入 `withOwnerReadAuth`，只有认证通过后才执行 `getServerAtlasApplication()` 和内部 `media.open`；`pm_` 路径只进入公开 `media.openDisplay`。`openOwnerVisitMediaResponse` 的独立行为测试证明 Owner internal-ID 路径能返回原始字节，并使用 allowlisted MIME、`Content-Disposition: inline`、`Cache-Control: private, no-store`，不回显 filename/ETag。
- `apps/web/features/atlas/atlas-api-client.ts:206` 与 `apps/web/features/atlas/atlas-api-client.test.mjs:123-124,186-190` 已把 Owner `media.list` 对齐为 `/api/media?visitId=...&itemId=...`，query encoding 回归通过，不再误发到 `/api/journal`。

round-1 发现亦未回归：

- `/api/inbox`、`/api/nearby` 与 `/api/media` 的私有 GET 仍在 Application composition 前执行 Owner read auth；公开 content 只接受 opaque `displayId`。
- Public Read projector 仍为闭合 DTO，sentinel、object key、原文件名、hash、internal media ID 与审计字段没有从匿名 JSON 恢复。
- display ID 仍由独立随机源生成且不等于 internal ID/object key；D1 公开查找只按 `display_id`；已有媒体 migration 在 schema 修改前 fail closed。
- caption/delete 仍能在 Owner 写鉴权后把 opaque display ID 映射回 internal ID；公开 capabilities 没有恢复失效的 legacy `list_visit_media` GET。
- 公开媒体仍限制为 JPEG/PNG/WebP/GIF，并返回固定 public cache、无 filename 的 inline disposition；legacy 私有 GET 不会因 HTTP GET 自动公开。

## 验证证据

- 相关 public/private read、Application/D1/migration/routes/browser/WebMCP/media 回归：主 focused suite 50/50 通过；因 Node 对含 `[id]` 的命令行路径按 glob 处理，另从对应目录显式执行 Owner content 1 项、public content 3 项与 Item responder 1 项，合计实际执行 55/55 通过。
- `npm run typecheck`：通过。
- scoped `npx oxlint ...`：通过，无新增 lint 问题。
- scoped `npx oxfmt --check ...`：失败，精确报告 Standards 所列 3 个文件。
- `git diff --check`：通过。
- `npm run build:owner-poc`：通过；产物包含 `/api/media/:id/content` 等预期 route。

本轮没有修改被评实现，只新增此评审结论。Spec 轴可以通过；Standards 的一般发现关闭前，Public Read integration 代码门仍为“需修改”。
