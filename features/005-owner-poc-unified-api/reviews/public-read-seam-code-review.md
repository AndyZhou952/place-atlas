# Public Read Seam 代码评审（第 1 轮）

- 日期: 2026-09-21
- 评审方式: subagent
- 固定点: `e7b4e06f36dc829edce0456869ae866acae076f3`
- 被评快照: 固定点加 2026-09-21 当前未提交工作区；`HEAD` 仍等于固定点，已用 `git diff --no-index` 完整读取 `apps/web/lib/server/public-read/**`
- 评审范围: `PublicReadManifest` 及其 JSON/media executor 接缝；不包含 route/Application/display-ID 映射的后续汇合
- 结论: 通过

## Standards

未发现严重或一般问题。

- `public-read-manifest.ts:102-145,171-180` 把授权放在 `load()` 之前；JSON 和 media 的未知 operation 都返回 404，4 项 contract tests 中的 Application/R2 计数器均为零。
- `public-read-manifest.ts:204-335` 通过逐字段重建 Catalog、Assessment、Visit 与 VisitMedia DTO，没有 spread 或领域对象直序列化；顶层、嵌套对象与媒体测试中的 sentinel、object key、原文件名、hash、内部字段都未出现在输出。
- `public-read-manifest.ts:182-200,365-372` 对媒体只允许 JPEG/PNG/WebP/GIF 的精确 MIME，成功响应只包含固定 public cache header、无 filename 的 `Content-Disposition: inline` 和 allowlisted `Content-Type`；上游现有上传路径另有文件头签名校验。
- 生产模块保持小接口与单一职责，未发现本轮新增的重复、发散式变化或投机抽象。

建议：

- [建议] `apps/web/lib/server/public-read/public-read-manifest.test.mjs:143-222`: 当前 Visit 负测同时提供了合法 `displayId` 和敏感的内部 media 字段，已能证明闭合投影；但没有显式锁定“只有内部 `id/objectKey`、没有 `displayId`时失败关闭”。→ T-04 接入真实 display-ID resolver 时增加该回归，防止后续为了兼容旧 `VisitMedia` 而回退使用内部 ID。

## Spec

就本次受评 seam 而言，实现符合 `spec.md` Acceptance Criteria 1–3 中的授权顺序、六个公开 operation allowlist、四类闭合 DTO、sentinel 防泄漏和媒体 header/MIME 约束。`projectVisitMedia` 仅接受 `displayId`，不会用当前领域的内部 `id` 做 fallback；因此在真实 opaque mapping 尚未存在时会失败关闭，而不是泄漏内部标识。

但本结论**不代表 T-02 或 T-04 已完成**，以下仍是发布阻断，不计为本 seam 自身的代码缺陷：

- 现有 Catalog/Visit GET responder 仍直接 `Response.json(result.value)`（`list-atlas-items-response.ts:8-20`、`get-atlas-item-response.ts:8-32`、`visit-responses.ts:22-31`），未经 `authorize -> load -> project`。在 routes 全部切换并有 route-level contract 前，公开投影不能上线。
- 当前 `AtlasApplication` 没有 `assessment.display`、`visit.listDisplay`、`visit.getDisplay` 或 `media.openDisplay` operation；也没有构造 `effectiveVisited + media[]` 的 display read model。这些需要中央 composition 汇合，不应在 route 内复制业务规则。
- 现有 `VisitMedia` 只有内部 `id`，并包含原文件名/hash 等非公开字段（`visit-media.ts:1-17`）；现有二进制 responder 也调用内部 `media.open`并返回 private cache/ETag（`open-visit-media-response.ts:8-35`）。T-04 必须先提供无法反推 object key/内部 media ID 的稳定 opaque display ID 与反向查找，再把 `media.openDisplay` 接到本 executor；禁止直接把现有 `id` 当作 `displayId`。
- 尚无 route-level 未知 GET 负测、真实 D1/R2 投影 contract 或部署 smoke，所以不得将本 seam 评审写成 T-02 勾选、owner-poc 可部署或公开数据安全门已通过。

## 验证证据

- `git rev-parse --verify e7b4e06`：固定点有效；`HEAD` 与固定点相同，本 seam 是未跟踪工作区新文件，因此另用 `git diff --no-index /dev/null <file>` 读取完整差异。
- `node --experimental-strip-types --test lib/server/public-read/public-read-manifest.test.mjs`：4/4 通过，0 failure。
- `npx oxlint lib/server/public-read/public-read-manifest.ts lib/server/public-read/public-read-manifest.test.mjs`：通过。
- `npx oxfmt --check lib/server/public-read/public-read-manifest.ts lib/server/public-read/public-read-manifest.test.mjs`：通过。
- 定向 source-only TypeScript 检查（Worker types）：通过。
- `npm run typecheck`：全仓仍因非本 seam 的 `scripts/migration-packaging.ts:81,124` 失败；`npm run lint` 也因同一 migration 类型错误与仓库旧测试的 `no-floating-promises` 失败。定向 lint/typecheck 已通过，但不将全仓门记为绿色。
