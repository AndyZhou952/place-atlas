# T-06A Google 中央组合代码评审（第 1 轮）

- 日期: 2026-09-17
- 评审方式: 独立 subagent 冷读
- 固定点: `HEAD`（`df2ec5958e974debca70b27b977662fd75cb7b87`）及当前工作树中本票固定范围的未跟踪实现
- 审查对象: 固定 Google transport/contract、T-06A 中央 composition 与 contracts、D1 provider-usage/contract、readonly service、nearby operation seam、Agent tools route、`0003_agent_provider_usage.sql`
- 结论: 需修改

## Standards

- [一般] `apps/web/adapters/agent/d1-provider-usage.sqlite.contract.test.mjs:44`: 真实 SQLite 并发硬门契约使用了无比较器的 `results.sort()`；scoped `oxlint` 报 `typescript(require-array-sort-compare)`，因此该固定范围未通过 lint gate。→ 使用显式、稳定的字符串比较器，随后重跑 scoped lint。
- [一般] `apps/web/adapters/agent/isolated-readonly-agent-service.contract.test.mjs:1`: 此固定范围的 readonly-service 契约测试未通过 scoped `oxfmt --check`。→ 仅格式化该测试，并将格式检查纳入本票回归。
- [一般] `apps/web/adapters/agent/isolated-readonly-agent-service.contract.test.mjs.orig`: 与固定范围的契约测试同目录保留未跟踪 `.orig` 备份，违反本票“无 tmp”工作区卫生要求，且可被误纳入后续改动。→ 在确认原测试已保留后移除该备份；不要删除非本票范围的文件。
- 除上述问题外，审查的实现没有发现 secret/raw provider response 日志或透传。固定 transport 将 API key 仅置于请求 header，采用 `redirect: 'manual'` 和严格 2xx，302 contract 确认零 follow、无第二次 fetch、无原始响应逃逸。请求 bridge 对 method、origin、path、query 和 structured body 作精确验证，用户输入不能改写三个固定 tuple。
- D1 ledger 的 `INSERT ... ON CONFLICT ... WHERE` 将 request/cost 上限置于同一原子更新；成本以整数 micro-USD 保存，错误 fail-closed。真实内存 SQLite contract 覆盖 migration 重入、并发一请求硬门、成本硬门与 UTC 月切换，而非只 mock SQL。本人另以顺序执行的内存 SQLite 验证 `0001_agent_readonly_fixture.sql` → `0002_agent_catalog_seed.sql` → `0003_agent_provider_usage.sql` 成功。
- `git diff --check` 通过。全库 `npm run typecheck` 未能作为本票通过证据：它被固定范围外、未跟踪的 `apps/web/scripts/migration-packaging.ts` 两个 Buffer 类型错误阻断；该文件及其 `.orig` 不归本票 finding。另有 `features/004-openclaw-atlas-poc/{spec,progress}.md.orig`，也不在本票固定范围，未归责于 T-06A 中央组合。

## Spec

- 无新的严重或一般 Spec finding。route 明确构造 `createT06aGoogleNearbyComposition`，并将其 `catalogRead` 和 `agentNearby` 传给 server application；composition 的 D1 Catalog read 真正进入 route，walking batch/shortlist 为 25、transit shortlist 为 5。
- Google evidence 仍为 `pending_review`，缺 key 选用 disabled gateway。本人运行的 composition contracts 确认 pending policy 与缺 key 都在 DNS、quota reservation 和 fetch 前零调用；generic ProviderPolicyGateway 回归亦通过，未见既有 provider 行为漂移。
- 审查到的 OpenClaw manifest/client 仍只发布 read-only `jpmap_nearby`；readonly HTTP contract 确认隐藏 write/destructive tool 被拒绝且不读取 fixture。这里的 D1 usage ledger 是内部预算门，而非 CatalogWrite 或用户可调用写工具。
- 本轮没有真实 provider egress、部署、凭证写入、reset 或真实 D1 migration；所有执行测试使用 local fake transport/fixture 或内存 SQLite。

## 验证记录

- 本人运行 aggregate focused/regression contracts：39/39 通过，覆盖三 tuple、3xx、pending/missing-key 预门、Google resolver/Routes、generic provider-policy、Agent readonly boundary、T-06A nearby 25/5、D1 SQLite ledger 与 catalog seed。
- scoped `oxlint` 复现上述一项错误；排除该已记录文件后其余固定范围 source/contracts lint 通过。
- scoped `oxfmt --check` 复现上述一项格式错误；排除该已记录文件后其余可格式化固定范围文件通过（SQL 不被 oxfmt 支持）。
- `git diff --check` 通过；全库 typecheck 的范围外阻断如上，未将其记为本票实现 finding。

## 结论说明

安全与行为要点已经由独立测试及冷读覆盖，但 2 个固定范围静态质量失败和 1 个同范围遗留备份均为一般 finding。因此本轮结论为**需修改**，不 auto-approve。修复后应只作格式/测试卫生修正，并复跑 scoped lint、format 与上述聚焦 contract 集。
