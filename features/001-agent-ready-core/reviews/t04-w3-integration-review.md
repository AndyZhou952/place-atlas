# T-04 Catalog 非破坏性写入与 W3 中央集成代码评审（第 2 轮）

- 日期: 2026-09-12
- 评审方式: 独立 subagent
- 固定快照: baseline `3cca6732a3ad4d5d96d44ef76ccffa1a8f789331` + 当前完整 working-tree fixed snapshot（含 untracked 文件）
- 结论: 通过

## 验证证据

- 已按 T-04 manifest 与 W3 中央集成范围冷读本轮修正、相关实现与测试；未修改实现代码。
- 首轮字段校验问题已关闭：`validateDiscoveredItem` 在 Application seam 同时拒绝 `id`、`title`、`description` 的空字符串和纯空白值，并保持 `invalid_input` 脱敏结果。Application contract 测试逐字段覆盖 `''` 与 `'   '`，Items HTTP adapter 测试对相同六种输入逐项断言 400；这些用例会在首轮实现上失败，属于有效回归测试。
- 首轮伪能力问题已关闭：`createCatalogReadOperationGroup` 的静态 key 集精确为 `catalog.list | catalog.get`；`createCatalogOperationGroup` 的 `CatalogWriteDependencies` 为必需参数，必须显式提供 `state` 与 `clock`。类型负例验证省略依赖无法编译，读取测试 fixture 只使用只读 group。
- 生产代码仍只有 `server-atlas-application.ts` 一个 `createAtlasApplication` 构造点；中央组合只创建一个完整 Catalog group，并把同一 `CatalogRead` 共享给 Catalog、Assessment 与 Decision。未发现第二 catalog、runtime registration、route 自建 application 或未注入依赖却公开写 key 的组合。
- needs_review-only、拒绝 verified、Clock 时间、D1 item/override upsert、title/description/personalState override、merge/refresh、tombstone/not_found、HTTP status/shape、错误脱敏与 media key 类型约束均由既有测试和类型检查继续覆盖。
- 定向测试：18/18 通过。
- 完整门禁：`format:check`、`lint`、`typecheck`、全量测试 108/108、`build` 全部通过。build 仅出现既有 Leaflet 图片解析警告。

## Standards

- 无发现项。首轮两项接口深度问题均已在正确 seam 修复：公共 Application validator 拥有写入不变量；读写能力由两个静态 operation group 精确表达，完整写 group 的 ports/Clock 在构造期强制注入。

## Spec

- 无发现项。T-04 非破坏性写入语义、Items POST/PATCH 协议映射，以及 W3 唯一中央静态 catalog、共享 CatalogRead、显式依赖与 JSON/media key 隔离均符合已确认规格与架构。
