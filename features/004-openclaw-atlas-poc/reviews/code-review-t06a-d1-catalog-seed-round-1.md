# T-06A D1 Catalog seed 代码评审 (第 1 轮)

- 日期: 2026-09-15
- 评审方式: subagent
- 固定范围: 相对 `HEAD` 新增的 `0002_agent_catalog_seed.sql`、`agent-catalog-seed.contract.test.mjs`、`d1-poc-catalog-read.ts` 与 `d1-poc-catalog-read.contract.test.mjs`
- 结论: 需修改

## Standards

- 未发现独立的 Standards 阻断项。四个固定范围文件无明显命名、重复、边界或异味问题；迁移采用 `INSERT OR IGNORE` 的“重放不覆盖用户后续修改”意图有行为测试锁定。

## Spec

- [一般] `apps/web/adapters/agent/d1-poc-catalog-read.ts:15`: 读适配器只取 `id/payload_json`，`verified_catalog` 也只信任 JSON 内的 `verificationStatus`；但迁移又把 `verification_status`、`kind`、`latitude`、`longitude` 作为独立列与 nearby 索引依据，且没有 SQL 约束保证它们和 JSON 一致。未来 intake 写入或局部更新只要使两份数据分叉，`needs_review` 行就可能因 JSON 标成 `verified` 而进入默认 nearby，或者粗筛用一组坐标、返回另一组坐标，违反“verified-only”与持久坐标粗筛的失败关闭要求。→ 让真值只有一份（例如用 JSON generated columns/约束），或读取所有冗余列并在返回前逐项校验，`verified_catalog` 按受校验的数据库状态过滤；增加 status/kind/coordinates 不一致时不泄漏记录的 contract tests。

## 证据

- 评审者以 `git diff --no-index /dev/null <file>` 冷读四个新文件，并完整对照 `spec.md`、`architecture.md`、`tickets.md`。
- 聚焦 contract tests: 4/4 通过（seed 完整性/幂等不覆盖、full/verified profile、非法 JSON、不完整 payload、row/payload ID 不一致、get/missing）。
- 固定范围 TypeScript/MJS 的 oxlint 通过；oxfmt 通过。
- 仓库级 `tsc --noEmit` 未通过，仅报告固定范围外、当前未修改的 `apps/web/scripts/migration-packaging.ts:81,124` 两个 `Buffer` 类型错误；本评审不将其归因于被评切片。
