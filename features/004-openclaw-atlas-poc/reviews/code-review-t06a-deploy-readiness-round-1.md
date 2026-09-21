# T-06A 部署就绪切片代码评审（第 1 轮）

- 日期: 2026-09-17
- 评审方式: 独立 subagent 冷读
- 固定点: `HEAD`（`df2ec5958e974debca70b27b977662fd75cb7b87`）及当前工作树的部署就绪实现
- 审查对象: `agent-poc-deployment-preflight.ts`、实际相关的 build-target/config contracts、`wrangler.agent-poc.jsonc`、package scripts/ignore rule、`.dev.vars.agent-poc.example` 和 Cloudflare PoC README
- 结论: 需修改

## Standards

- [一般] `apps/web/scripts/agent-poc-build-target.test.mjs:47`: build-target contract 将 `createWebViteConfig('agent-poc')` 的 config path 硬断言为 checked-in template；但 runbook 要求部署前创建且 `.gitignore` 排除的 `wrangler.agent-poc.local.jsonc` 已在当前工作树存在，实际实现会正确选择该 local config，故聚焦套件 27/28 失败。→ 将文件存在性注入 test seam，或在 contract 中显式覆盖 template fallback 与 local-config selection 两种受控情形；不要要求部署环境删除其本地配置。
- `GOOGLE_MAPS_API_KEY` 以 required Cloudflare `secret_text` 名称进入 preflight；template 仅包含 `<replace-me>`，README 只使用 interactive `wrangler secret put`，没有值进入 command argument、Git 或 evidence。missing/present secret contracts 均已覆盖。
- `inspectAgentPocDeployment` 同时验证 source/built Worker、D1/R2 fixture 名称和 ID 对等、readonly fixture vars、Sites metadata 拒绝、D1 sentinel 与远端 secret-name list；package deploy script 强制 build → preflight → strict deploy，未看到隐式 activation 或部署动作。
- scoped `oxlint`、`oxfmt --check` 和 `git diff --check` 均通过。本人尝试实际 `npm run build:agent-poc`，但当时宿主 `/` 分区 100% 满，npm 在写入时返回 `ENOSPC`；这是环境容量限制，不能证明本票 build target 有第二个实现缺陷，亦不能作为通过证据。

## Spec

- 除上述 Standards finding 外，无新的严重或一般 Spec finding。runbook 严格要求只建隔离 fixture Worker/D1/R2、在 ignored local config 填 D1 ID、按 `0001_agent_readonly_fixture.sql` → `0002_agent_catalog_seed.sql` → `0003_agent_provider_usage.sql` 顺序执行，并在账户/资源/secret 到位和 preflight 通过前 STOP；没有生产 Sites/D1/R2 或 reset 路径。
- D-P04 与中央组合 Round 2 的关闭边界保持：README 明说 Google policy 是 `pending_review`，即使 secret 存在也禁止真实 Google calls，直至独立 activation evidence 获批。本人运行 pending-policy、missing-key、fixed endpoint 和通用 provider-policy 回归，均通过且只用 local fixture/fake transport。
- build-target contract 继续证明 agent-poc mode 不加载 Sites 或 hosting metadata；默认 production build 保持既有 Sites/local-binding projection。该条行为正确，但其 test 尚未隔离 normal local-config existence，故不能以失败的全套聚焦验证作为部署就绪门的充分证据。
- 本审查未运行 deploy、Cloudflare mutation、真实 migration、provider egress 或 credential 写入。

## 验证记录

- 本人运行 deployment-preflight/build-target/config、pending/missing-key、Google endpoint 与 provider-policy 聚焦 contracts：27/28 通过，唯一失败为上述 local-config 环境相关但本票应修的 test assertion。
- 本人运行 scoped `oxlint`、`oxfmt --check`、`git diff --check`：通过。
- 本人检查实际本地 config：其为被 `.gitignore` 排除的 `wrangler.agent-poc.local.jsonc`，正是 README 规定的部署前置条件；因此不能将该失败笼统标为范围外 baseline。
- 实际 `build:agent-poc` 受当时宿主磁盘 `ENOSPC` 阻断，未产生部署或远端调用。

## 结论说明

secret-name、preflight、migration order、pending-policy 和非部署边界均符合本票要求，但 build-target test 在合法、预期的 local-config 环境中失败。该一般 finding 修复并重跑聚焦 suite 后，方可通过部署就绪代码门；本轮不 auto-approve。
