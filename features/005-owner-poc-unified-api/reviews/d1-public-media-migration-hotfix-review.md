# D1 Public Media Migration Hotfix 代码评审

- 日期: 2026-09-21
- 评审方式: subagent
- 固定点: `663776acd5517d9192ad4eda08c832e4bd4670d0`
- 被评范围: `0005_public_media_display_id.sql` 与 `public-media-display-migration.test.mjs` 两个 tracked files；排除其余工作区文件
- 结论: 通过

## Standards

未发现需要修改的 Standards 问题。

- `0005` 不再创建 D1 禁止的 TEMP schema，而是使用名称带 migration 序号的普通事务内 gate table；成功路径主动删除 gate，失败路径依赖 D1 migration transaction 整体回滚，边界小且意图清楚。
- contract test 明确包裹 `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`，同时检查 persistent 与 temporary schema 均无 gate residue，避免只断言错误却遗漏半迁移状态。
- 固定点到当前工作树只有指定的两个 tracked files 发生变化；已远端应用的 `0001`–`0004` 相对固定点无任何 diff。鉴于背景已确认旧 `0005` 完全回滚且未写入 migration journal，本次修改未建立“改写已应用 migration”的先例。

## Spec

未发现需要修改的 Spec 问题。

- 空 owner database 路径成功增加独立 `display_id`、唯一索引及非空 insert/update guards；migration gate 在成功后不存在。
- 存在 legacy `visit_media` row 时，gate 的 `CHECK (existing_rows = 0)` 在 `ALTER TABLE` 之前失败；测试证明原 row 保留、`display_id` 未增加、persistent/temp gate 均未残留，符合 public opaque ID 无法安全回填时失败关闭的要求。
- hotfix 不改变 Public Read DTO、opaque ID 语义或 0001–0004 schema/data；只修复 Cloudflare D1 对 `CREATE TEMP TABLE` 返回 `SQLITE_AUTH` 的平台兼容问题。

## 独立验证证据

- `public-media-display-migration.test.mjs`: 3/3 通过，exit 0；覆盖禁用 TEMP、空库成功、legacy rows 原子失败关闭与零 residue。
- `npm run migration:check`: 通过，exit 0。
- scoped `oxfmt --check` 与 `oxlint`: 通过。
- `git diff --check 663776a -- <两个被评文件>`: 通过。
- `git diff --exit-code 663776a -- 0001 0002 0003 0004`: 通过，确认四个已应用 migration 未修改。

部署边界保持不变：本结论只确认 hotfix 可以重新尝试尚未记录的 `0005`；若 migration journal 将来显示 `0005` 已应用，则不得再次通过原文件内容变更处理。
