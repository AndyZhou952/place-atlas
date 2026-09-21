# Owner PoC integration 代码评审（第 3 轮）

- 日期: 2026-09-21
- 评审方式: subagent
- 固定点: `e7b4e06f36dc829edce0456869ae866acae076f3`
- 评审范围: canonical seed evidence、target database ID、不超过 5 分钟的 freshness、canonical drift 负测与 runbook 采集顺序
- 结论: 需修改

## Standards

- [一般] `features/004-openclaw-atlas-poc/deployment/cloudflare-owner-poc/README.md:65`: runbook 仍在第 2 步直接把 Wrangler 原始数组输出重定向为最终 `owner-poc-seed-evidence.json`，没有调用新增的 `owner-poc-seed-evidence-envelope.ts`；该文件因此缺少 preflight 必需的 `databaseId` 和 `capturedAt`，按文档操作会 fail closed。而且采集与第 4 步 preflight 之间还隔着 secrets/build 步骤，不满足“紧邻采集”，容易超过 5 分钟 → 在 build 之后、preflight 紧前连续执行：Wrangler 输出到临时 raw rows 文件，再用 envelope CLI + 同一 local config 生成最终 evidence，立即执行 preflight；并用 runbook/command contract 防止再次脱节。

## Spec

- 无新的实现级规格偏差。`owner-poc-seed-evidence.sql` 已改为查询 canonical `atlas_items`；preflight 已将 evidence 绑定到 source config 的 target D1 `database_id`，拒绝未来时间和超过 5 分钟的证据；canonical payload 漂移而 legacy payload 未变的负测会正确阻止发布。

## 自行复核证据

- 18 个完整 owner-poc 定向测试通过，覆盖 canonical drift、错误 database ID、超过 5 分钟的 evidence、envelope、迁移与 build target。
- `npm run migration:check` 通过。
- `npm run typecheck` 在并行编辑稳定后重跑通过。
- `npm run build:owner-poc` 通过，artifact 为 `japan-atlas-owner-poc` 且只绑定 owner D1/R2。
- 评审者通过 envelope CLI 生成带 target database ID/当前时间的 canonical evidence，真实 preflight CLI 通过。这证明实现链可用，但当前 runbook 没有把该链串起来。
