# Public Read Integration 代码评审（第 2 轮）

- 日期: 2026-09-21
- 评审方式: subagent
- 固定点: `e7b4e06f36dc829edce0456869ae866acae076f3`
- 被评快照: 固定点加 2026-09-21 当前未提交工作区（`HEAD` 仍等于固定点）
- 结论: 需修改

## Standards

- [一般] `apps/web/features/atlas/atlas-api-client.test.mjs:64-206`：round-2 将 Owner `media.list` 恢复为 `/api/media?visitId=...&itemId=...`，但既有完整 Browser route-shape 回归仍期待 `/api/journal`。评审者扩大重跑 50 项相关测试时为 49 pass / 1 fail。→ 更新该既有回归以锁定新的 Owner 私有读取及 query encoding，并与匿名 fallback 测试一起重跑。

其余 round-1 Standards 发现已关闭：media attach 测试已注入确定性 `displayIdSource` 并断言持久化值；本轮新增测试使用 `void test(...)`；本轮 scoped lint 和 format 均通过。

## Spec

- [严重] `apps/web/product/application/media/media-operations.ts:71-80,532-540`、`apps/web/features/atlas/public-read-client.ts:91-97`、`apps/web/app/api/media/[id]/content/open-visit-media-response.ts:20-23`：登录 Owner 的私有 `media.list` 保留 internal media ID 以支持 caption/delete 是正确的，但它同时生成 `/api/media/<internal-id>/content`；二进制 content route 只调用 `media.openDisplay`，要求 `pm_*` display ID。评审者从真实 `media.list` 输出提取 content URL 后调用同一 `media.openDisplay` operation，得到 `invalid_input`，因此登录后已有或刚上传照片的图片内容无法显示。→ 私有列表/上传响应应保留 internal `id` 作为 mutation handle，但 `contentUrl` 必须由该记录的 opaque `displayId` 生成；增加“Owner 私有 list/attach → 打开 contentUrl → 成功读流”的闭环 contract，禁止把内部 ID 再开放给 public content route。

round-1 其余 Spec 发现已关闭：

- `/api/inbox`、`/api/nearby`、`/api/media` GET 均通过 `withOwnerReadAuth` 在 Application composition 前失败关闭；匿名读取不会触发对应 handler。
- 匿名媒体读取在私有 GET 返回 401 后回退到 Journal 的闭合 Public Read DTO，未恢复 object key、原文件名、hash 或内部 ID。
- caption/delete 已能把 opaque display ID 解析回 internal ID，并在 Owner 写鉴权后完成 mutation。
- `list_visit_media` 已从公开 capabilities 移除。
- Public Read projector、opaque display-ID D1 lookup、已有媒体 migration fail-closed、媒体 MIME/header 约束仍保持通过。

## 验证证据

- 相关 public/private read、Application/D1/migration/routes/browser/WebMCP/media 回归共 50 项：49 通过、1 失败；失败为上述 `atlas-api-client.test.mjs` 旧 route-shape 期望。
- Owner content URL 行为 probe：`media.list` 返回 `/api/media/internal-1/content`；把该路径 ID 交给 content route 使用的 `media.openDisplay` contract 后返回 `invalid_input`。
- `npm run typecheck`：通过。
- round-2 精确文件 `npx oxlint ...`：通过。
- round-2 精确文件 `npx oxfmt --check ...`：通过。
- `npm run build:owner-poc`：通过。

本轮没有修改被评实现，只新增此评审结论。上述严重与一般发现关闭前，Public Read integration 仍不得进入部署门。
