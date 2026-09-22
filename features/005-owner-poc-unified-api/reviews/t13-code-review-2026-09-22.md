# T-13 持久 session/CAS 与 transient Google 代码评审

- 日期：2026-09-22
- 评审方式：subagent
- 固定点：`4aae3c49cb082e2549ab67031b4889e16880b55c`
- 范围：当前 working tree 的 T-13 实现；排除 `evidence/t08-owner-poc-nearby-e2e-2026-09-22.md` 与三个用户 `.orig` 文件
- 结论：**需修改（NEEDS CHANGES）**

## Standards

- **[一般] `apps/web/product/application/catalog-intake/catalog-intake-coordinator.ts:1304-1320`：过期转换的 CAS 冲突被无条件当成“已过期”，会对已经被并发请求成功续期的 session 返回错误事实。** `expireIfNeeded()` 先根据旧快照判断到达 30:00，再执行 `compareAndSwap()`，但完全忽略返回值并固定返回 `true`。独立运行时探针让 CAS 返回一个 version 2、未来 `expiresAt` 的已续期 current session，`select` 仍返回 `AddError.code='expired'`。这使 CAS 只保护写入却没有保护读取后的业务决定，也缺少对应并发回归。→ 让过期辅助函数返回闭合结果（例如 `expired | current | conflict`）；CAS conflict 时基于 `current` 重新判断／按新版本返回 conflict，而不能宣告旧快照已成功过期；补一条“过期 CAS 与 accepted activity 并发”的 operation contract，并分别证明真正过期、续期胜出和终态胜出。

其余 Standards 检查未发现阻塞项：状态与 provider 接缝仍位于 `CatalogIntakeModule`／ports 后；D1 replacement、terminal CAS 与 cleanup 使用原子 batch，terminal collision 会整体回滚；错误信息闭合且 production default 仍 fail closed。新增 Google adapter 只输出闭合 identity/presentation，malformed、duplicate、blank、non-finite 与 refetch identity mismatch 均在写 state 前失败。未发现 React、route、D1 或 provider SDK 反向进入 Product Core，也未发现 T-14 durable geocoder、T-15 research 或 T-16 publish 越界。

## Spec

- **[一般] `apps/web/lib/server/application/d1-catalog-intake-state.ts:156-181`、`apps/web/lib/server/application/server-atlas-application.ts:77-80`：24 小时清理只有一个从未被运行路径调用的方法，尚不能兑现“最迟 24 小时清理”。** 当前唯一 `cleanup(now)` 调用都在测试中；server composition 继续装配 unavailable intake module，也没有 scheduled handler 或其他 owner-poc 运行入口调用 D1 cleanup。方法本身能把到期 active payload 原子换成 minimal terminal reference，但 abandoned session 在没有显式操作和没有测试直接调用时可以无限保留 candidate/preview。production 在本票保持 fail closed 是正确的，但没有未来运行调用的所有权就不能把 T-13 的 24h retention 行为视为完成。→ 在不启用真实 Add 的前提下，为 cleanup 建立明确的 production composition/scheduled ownership（或在票/架构中明确把该门移交到启用前票），并以跨 24h 的 runtime contract 证明 active payload 被清除、terminal/token 保留至 180 天且并发 accepted activity 不被误删。

已确认符合的规格行为：

- 29:59 的合法 select 续期，30:00 的 select/discover retry 过期；invalid/dependency 路径不会写 activity，cancel 为原子终态并可稳定重放。
- owner/channel/conversation 隔离、单 active replacement、request-token replay／异 query conflict、select 同 version/同 payload replay 与异 payload conflict均有闭合行为。
- D1 migration 为 append-only/replay-safe；scope 唯一索引、replacement batch、active/terminal CAS 与 terminal collision rollback 保持原子，最小 terminal/token 的 180 天边界测试通过。
- Google query 对日／中／英原样透传；候选按 relevance 降序、规范化 Place ID 升序稳定 tie-break，Top 3、`hasMore` 与 select refetch 已覆盖。
- durable state 只含 Owner query 与 `{providerNamespace, placeId, ordinal, createdAt}`；Google name/address/attribution 不进入 state 或 preview digest，额外 raw/hash/coordinates 在 core port validator 失败关闭；当前差异没有 Leaflet 或日志写入路径。
- production composition 仍使用 unavailable module，未开放真实 provider 或 Add 写入。

## 独立验证证据

- 聚焦 operation、Google provider 与 SQLite/D1 contracts：**23/23 通过**。
- `npm run typecheck`：通过。
- `npm run lint`：通过。
- `npm run format:check`：通过。
- `git diff --check`：通过。
- 独立 CAS-race 探针：renewed current session 存在时仍返回 `expired`，复现上述 Standards finding。

# 第 2 轮复审

- 日期：2026-09-22
- 评审方式：subagent
- 固定点：`4aae3c49cb082e2549ab67031b4889e16880b55c`
- 范围：仅复核第 1 轮两项发现与相关回归；当前 working tree 的 T-13 变更，排除指定 T-08 evidence 与 `*.orig`
- 结论: 通过
- 用户确认：2026-09-22

## Standards

无严重、一般或建议发现。

- `apps/web/product/application/catalog-intake/catalog-intake-coordinator.ts:1364-1412`：`expireIfNeeded()` 现在返回闭合的 `active | expired | cancelled | conflict`。过期 CAS 失败后读取 winner：并发续期且新 `expiresAt` 有效时返回 active，调用方随后因旧 expected version 稳定返回 conflict，不再错误宣告 expired；expired winner 返回 expired；cancelled winner 由 cancel 路径稳定回放。operation contract 同时覆盖 renewed、expired、cancelled 三种 winner。
- 回归边界保持：无 T-14 durable geocoder、T-15 research、T-16 publish 或部署实现进入本轮；production 默认 intake module 继续 fail closed，遗留 `POST /api/items` 未开放；Agent 配置/入口与 Sites 未改动。

## Spec

无严重、一般或建议发现。

- `apps/web/wrangler.owner-poc.jsonc` 将 owner-poc 独立入口改为 `owner-poc-worker.ts` 并配置 `0 3 * * *` 每日 cron；入口仍委托原 vinext fetch handler，只为 owner-poc 增加 scheduled cleanup。worker contract 证明 scheduled handler 使用 `ScheduledController.scheduledTime`，且 Agent 入口仍为 `vinext/server/fetch-handler`。
- `apps/web/lib/server/application/d1-catalog-intake-state.ts:128-157` 的 cleanup 通过一个 D1 `batch` 原子执行：仅把 `expires_at_ms <= scheduledTime` 的 active row 转为最小 expired terminal reference，再按相同 source version 删除 active payload；并发续期先胜出时不匹配，不会误删。D1 contract 覆盖续期不误删、terminal collision 整批回滚、payload 清除、request/terminal 保留及 180 天边界删除。
- 每日调度保证 abandoned active candidate/preview payload 在到期后最迟下一次 daily sweep 清除；cancel/replacement 即时移除 active payload。terminal/request retention 仍固定为 180 天。

## 独立验证证据

- 四个指定聚焦文件：**27/27 通过**（CatalogIntake operations 17、Google provider 4、D1 SQLite 4、owner-poc worker 2）。
- `npm run typecheck`、`npm run lint`、`npm run format:check`（277 files）：通过。
- `git diff --check 4aae3c4`（排除指定 evidence 与 `*.orig`）：通过。
- `npm run build:owner-poc`：通过。构建后 `apps/web/dist/server/wrangler.json` 为 `main: index.js` 且保留 `triggers.crons=["0 3 * * *"]`；`apps/web/dist/server/index.js` 包含 D1 cleanup、`new Date(controller.scheduledTime)` 与带 `scheduled` 的默认导出。
