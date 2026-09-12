# T-09 Visit/AtlasItem 破坏性流程代码评审（第 1 轮）

- 日期: 2026-09-12
- 评审方式: 独立 subagent
- 固定快照: baseline `3cca6732a3ad4d5d96d44ef76ccffa1a8f789331` + 当前完整 working-tree fixed snapshot（含 untracked 文件）
- 结论: 通过

## 验证证据

- 已按 T-09 manifest 冷读完整新文件与中央集成变更，并与 baseline 的 `deleteJournalEntry`、`deleteAtlasItem`、两条 DELETE route 及单媒体删除行为逐项对照；未修改实现代码、任务票或进度。
- `visit.delete` 与 `catalog.delete_item` descriptor 均为 `resultKind: json`、`effect: destructive`，空白 ID 经 Application runtime validator 返回 `invalid_input`。
- Visit 删除先以一次 D1 context read 取得 AtlasItem 投影上下文、删除前 Visit 数与该 Visit 的全部 R2 key，再以单次 D1 `batch` 原子删除 `visit_media`、`visits` 与 legacy `journal_entries`；提交后以“剩余 Visit OR manualVisited”重新投影返回条目。四格真值测试覆盖删除最后/非最后 Visit 与 manualVisited 两种状态。
- AtlasItem 删除先读取完整聚合与全部媒体 key，再以单次 D1 `batch` 删除 `visit_media`、`visits`、legacy `journal_entries`、`place_assessments`、`atlas_item_overrides`、`atlas_items`，最后在同一 batch upsert tombstone。动态条目的 InMemory contract 验证全聚合清除与 tombstone；Catalog 投影测试验证 tombstoned 条目不可见，重复删除返回 `not_found`。
- 两类级联删除均只在 D1 成功后以 `Promise.allSettled` best-effort 清理全部 R2 key；R2 单项失败不改变成功结果并允许 orphan。D1 commit 失败返回固定脱敏 `dependency_failure`，不会触发 R2；D1 adapter 的失败测试确认写入只经一个 batch、没有独立 `.run()` 写入。相对地，`media.delete` 继续保持 D1 metadata 已删而 R2 删除失败时返回 `dependency_failure`，两种语义未混淆。
- 两条 DELETE route 只取得路径 ID、调用唯一 server AtlasApplication 并映射响应；成功 JSON、400、404 与 500 形状保持 baseline 类别，底层 D1/R2 文本不泄漏。未发现 handler 互调、route 规则复制、存储直连、第二 operation catalog 或 runtime operation registration。
- 中央 composition 只创建一个生产 AtlasApplication；同一 Catalog-owned `CatalogItemProjection` 注入 Visit 与 destructive group，同一 R2 object adapter 注入 Media 与 destructive group。新增两个 destructive JSON key 已进入中央静态类型目录，`media.open` 的 media-stream 隔离仍由负面类型测试保护。
- 定向验证：26/26 通过；覆盖 destructive Application/InMemory、D1 adapter、HTTP mapping、Catalog tombstone 与 single-media-delete 对照。
- 完整门禁：`format:check`、`lint`、`typecheck`、全量测试 138/138、`build` 与 `git diff --check 3cca673` 全部通过。build 仅出现既有 Leaflet 图片解析警告。

## Standards

- 无发现项。破坏性跨存储编排集中于单一深 operation group；Product Core 只依赖窄的 record/projection/object/Clock seams，不导入 React、route、D1/R2 或供应商 SDK。D1 原子边界与 R2 best-effort 边界清晰，没有规则复制或范围外的 retry/reconcile/Trash 抽象。

## Spec

- 无发现项。两类现有硬删除、tombstone、D-009 到访重算、D1/R2 失败顺序、orphan 允许、单媒体删除差异、脱敏错误、HTTP 兼容及中央静态接线均符合已确认规格、架构与 T-09 验收。
