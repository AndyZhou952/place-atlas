# Owner PoC storage / deployment / Agent integration 代码评审（第 1 轮）

- 日期: 2026-09-21
- 评审方式: subagent
- 固定点: `e7b4e06f36dc829edce0456869ae866acae076f3`
- 评审对象: 相对固定点的当前 working tree；owner-poc schema/seed/runbook/config/preflight/build target/canonical Agent Catalog/composition/route，以及 legacy read-only Agent 回归
- 结论: 需修改

## Standards

- [一般] `features/004-openclaw-atlas-poc/deployment/cloudflare-owner-poc/README.md:71`: runbook 要求把 `GOOGLE_MAPS_API_KEY` 写入 owner Worker，并在第 4 节声称 preflight 要求 Google secret；但 `apps/web/scripts/owner-poc-deployment-preflight.ts:5` 的必需列表故意不含 Google，且 `:79` 会拒绝该 secret。按 runbook 操作必然导致预检失败，并诱导把 provider credential 放入错误信任区 → 删除 owner Worker 的 Google secret 步骤，明确 Google key 只属于后续独立 Sidecar，并让 runbook 对 preflight 的描述与实现/测试一致。
- [建议] `apps/web/app/api/agent/v1/tools/owner-poc-route.contract.test.mjs:7`: 测试通过正则搜索 route 源码判定 owner branch，只能证明几个字符串存在，无法证明组合根真正使用 canonical D1 adapter 或签名请求能穿越 route → 增加行为级 contract，以 owner-poc bindings 发送一次有效 HMAC 请求，断言 canonical tables、nonce/receipt/audit 与稳定响应；源码正则只作辅助。
- [建议] `apps/web/adapters/agent/isolated-readonly-agent-service.ts:71`: owner-poc 生产组合复用名为 `createFixtureAgentKeyStore` 的构造器，名称暗示“只限 fixture”却实际承载 owner secret，属于神秘/误导命名 → 重命名为渠道无关的 `createSingleOwnerAgentKeyStore`，或拆出 owner 专用 adapter。

## Spec

- [严重] `features/004-openclaw-atlas-poc/deployment/cloudflare-owner-poc/0001_owner_poc_schema.sql:103` 与 `0002_owner_poc_catalog_seed.sql:40`: 迁移只创建/插入地点行，没有落盘 `owner-poc-seed-v1`、源 artifact、`recordCount=5` 和指定 SHA-256；`d1-owner-poc-catalog.sqlite.contract.test.mjs:15` 也只校验行数。因此 T-01/验收标准 29 要求的 payload/count/digest 部署门实际不存在，迁移内容漂移仍可通过 → 增加不可变 seed manifest 记录与发布前验证器，同时以受控失败测试证明 ID/count/source digest/规范 payload digest 任一不符即停止。
- [严重] `features/004-openclaw-atlas-poc/deployment/cloudflare-owner-poc/0001_owner_poc_schema.sql:87`: `agent_provider_usage` 仍以 `(provider_id, period_start_utc)` 为主键，只有 `request_count/cost_micro_usd`，没有 SKU 与 billable unit/element。它无法分别强制 Geocoding 8,000 requests 与 walking Matrix 8,000 elements，也无法表达 origins × destinations。这不满足 T-01 的“分 SKU usage migration”和验收标准 24 → 在真实 Sidecar/egress 之前将 ledger key 升级为 provider + SKU + UTC period，记录原子预留的计费单位，并增加分 SKU 并发边界测试。
- [一般] `apps/web/adapters/agent/isolated-readonly-agent-service.ts:69` 与 `apps/web/adapters/agent/owner-poc-agent-composition.ts:7`: owner 分支仍装配 `NearbyApplicationDefinitions`/`createProjectCommandRouter`，返回渠道专用 `replyText`，没有实现规格的结构化、渠道无关 `nearby.recommend`。这个骨架确实已改为读 `atlas_items/place_assessments/visits`，且 Route Sidecar 未就绪时会 fail closed，但不得因此标记 T-05 或“Web/微信共用 Nearby operation”完成 → 保留兼容 presenter，将核心改为同一 structured operation，再用 Web/Agent 等价 contract 关闭 T-05。

## 自行复核证据

- 49 个 owner-poc + legacy Agent contract/integration tests 全部通过；覆盖 HMAC/owner/channel/scope、nonce replay、receipt conflict/replay、audit、legacy fixture isolation、owner canonical Catalog/Personal Facts、空库 seed 与重放。
- `npm run migration:check` 通过。
- `npm run build:owner-poc` 真实构建通过；构建后立即读取的 artifact 为 `japan-atlas-owner-poc`，只绑定 owner D1/R2，`services=[]`，无 Google/Foursquare/Transit secret 或 egress binding。
- 真实 preflight CLI 对非 placeholder D1 ID、匹配 build artifact 和六个 secret name 通过；禁止 Google secret 的负测通过。
- 用 SQLite 执行完整 owner migration chain 后，5 条 `atlas_items.payload_json` 与 `verified-items.ts` 当前值逐条完全一致；但此结果未被实现为发布门，故不消解上述 seed manifest 发现项。
- 全库 `typecheck`/`lint` 未通过，错误来自固定点已存在且本评审范围未修改的 `scripts/migration-packaging.ts` 与旧 `.mjs` promise lint 债务；本轮不将其归因于 owner-poc diff，但在作为仓库发布门之前仍需另行清理。
