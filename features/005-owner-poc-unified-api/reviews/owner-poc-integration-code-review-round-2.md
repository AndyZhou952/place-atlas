# Owner PoC storage / deployment / Agent integration 代码评审（第 2 轮）

- 日期: 2026-09-21
- 评审方式: subagent
- 固定点: `e7b4e06f36dc829edce0456869ae866acae076f3`
- 评审对象: 相对固定点的当前 working tree；第 1 轮 owner-poc storage/deployment/Agent integration 发现项的修复
- 结论: 需修改

## Standards

- [建议] `apps/web/app/api/agent/v1/tools/owner-poc-route.contract.test.mjs:7`: 第 1 轮提到的 route 源码正则测试仍然存在，它不能代替有效 HMAC 请求穿越真实 owner composition 的行为 contract → 后续在 T-05/T-08 增加 route 级有效签名成功、canonical D1 读取、nonce/receipt/audit 断言；当前正则测试只作组合形状辅助。
- [建议] `apps/web/package.json:18`: 官方 `npm run lint` 在本评审中仍返回 1，错误是广泛存在于固定点/并行范围的旧 `.mjs` `no-floating-promises` 债务，不是本 owner-poc production diff 引入；本轮针对全部受评 production TypeScript 的 scoped `oxlint` 通过 → 在全仓 ship 前清理或以明确 baseline/changed-files 门处理，不得对外声称当前全库 lint 已通过。

## Spec

- [严重] `apps/web/scripts/owner-poc-seed-evidence.sql:12` 与 `apps/web/package.json:15`: seed 发布门查询的是 legacy `agent_catalog_items`，不是 T-01/验收标准 29 规定的 canonical `atlas_items`；且 `preflight:owner-poc` 只读取一个事先生成、可重用的 `.wrangler/owner-poc-seed-evidence.json`，并不在同一发布门中重新查询当前目标 D1。评审者在内存 D1 执行完整迁移后故意篡改 `atlas_items` payload，现有 evidence + `inspectOwnerPocSeed` 仍返回 `{ready:true}`；旧的正确 evidence 文件也可在远程 D1 后续漂移后继续通过。因此当前尚不是“部署时核验 canonical D1 行”的远程门 → evidence SQL 必须 join `atlas_items`，增加 canonical 行缺失/篡改负测；并把远程 evidence 抓取与 preflight/deploy 绑定为同一次不可复用的步骤（或至少验证目标 database ID 和严格 freshness）。

## 第 1 轮发现项复核

- Seed manifest 的 version/source/count/source SHA/per-record digest/aggregate digest 已落盘，本地 payload/ID/count/source 漂移负测通过；但 canonical remote evidence 缺口使该项尚未完全关闭。
- `agent_provider_usage_by_sku` 已以 provider + SKU + UTC period 为键，记录 request count/billable units/cost；Geocoding requests 与 walking Matrix elements 的 8,000 边界、并发原子预留和 legacy 回填测试通过。真实 Sidecar 仍受 T-06 后续门禁。
- Runbook 已删除 owner Worker 的 Google key 配置步骤，并明确禁止该 secret；owner build artifact 只含 owner D1/R2，`services=[]`。
- `createFixtureAgentKeyStore` 已重命名为 `createSingleOwnerAgentKeyStore`，原神秘命名发现项关闭。
- `progress.md` 明确记录 T-05 仍未完成；当前 owner Agent 是 fail-closed 的兼容 Nearby 骨架，本轮未错误声称 structured `nearby.recommend` 已交付。

## 自行复核证据

- 52 个 owner-poc + legacy Agent contract/integration tests 全部通过（包含作者报告的 25 个定向测试的超集）。
- `npm run migration:check` 通过。
- `npm run typecheck` 通过。
- `npm run build:owner-poc` 真实构建通过；构建后立即读取的 artifact 为 `japan-atlas-owner-poc`，只绑定 owner D1/R2，无 provider secret/service binding。
- 真实 preflight CLI 对匹配 build config、六个 secret name、manifest 和当前生成 evidence 通过。
- 受评 production TypeScript 文件的 scoped `oxlint` 通过；全库 `npm run lint` 未通过，见 Standards 建议项。
- `git diff --check` 对受评 tracked diff 通过。
