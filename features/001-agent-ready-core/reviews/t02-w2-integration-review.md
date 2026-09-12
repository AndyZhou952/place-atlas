# T-02 ImportJob 写入与 W2 中央集成代码评审 (第 1 轮)

- 日期: 2026-09-12
- 评审方式: subagent
- 固定快照: baseline `3cca6732a3ad4d5d96d44ef76ccffa1a8f789331` + 当前完整 working tree（含 untracked 文件）
- 结论: 通过

## 验证证据

- 已冷读 T-02 ImportJob group/port/InMemory/D1/HTTP 路径及 W2 Catalog、Decision、Media groups、route helpers、中央 composition root 和类型门；未采信实现者摘要。
- T-02 定向及 W2 adapter/集成测试共 40 项通过；`format:check`、`lint`、`typecheck`、全量测试（66 项）与 `build` 全部通过。build 仅出现既有 Leaflet 图片解析警告。
- queue 保持 source/creator 归一化、五类既有平台推断、显式 platform、`queued` 初态、计数、等待 collector 文案及 201 JSON；Clock/IdSource 在 Product Core 中为必需注入，仅 composition root 提供系统实现。
- delete 保持成功 `{ id, deleted: true }`、不存在 404，并在 InMemory 与 D1 port 上验证删除结果；queue/delete 的 D1 与 HTTP dependency failure 均映射为固定脱敏正文，未增加 worker、幂等、鉴权或新错误类别。
- 生产侧只有 `server-atlas-application.ts` 创建 AtlasApplication；中央以静态 spread 汇总 3 个 Import、1 个 Catalog、2 个 Decision/Catalog、2 个 Media operation，共 8 个 key。未发现 runtime registration、第二份 operation catalog 或生产 route 自建 application。
- Inbox GET/POST/DELETE 及 W2 已迁移的 Items GET、Nearby GET、Media GET/content GET 均调用同一 server AtlasApplication；并行 response helper 只接收领域窄化的 AtlasApplication，不再拥有独立 composition。
- `media.open` 仍只能经 `openMedia`，JSON/media key 负面类型测试及中央 8-key typecheck 均通过；Product Core 无 React、Next、WebMCP、D1/R2 或 feature-layer import。

## Standards

- 无。

## Spec

- 无。
