# Feature 004 第一／二阶段切片代码评审（第 2 轮）

- 日期: 2026-09-13
- 评审方式: subagent
- 固定点: `HEAD df2ec5958e974debca70b27b977662fd75cb7b87`
- 范围: T-01/T-02/T-05/T-06/T-07/T-08、T-03 本地部分、T-11 离线部分；排除 feature003、线上部署与真实供应商启用
- 结论: 需修改

## Standards

无新增严重或一般发现。

第一轮 Standards 发现均已关闭：`agent.nearby` 已进入中央 `createServerAtlasApplication` 与静态 operation catalog，isolated service 不再创建第二个生产应用入口；公网地址分类改用 `ipaddr.js` 并规范化 IPv4-mapped IPv6；D1 mutation 使用唯一 claim、等待与条件 commit；非法 key ID 只以 `unknown` 进入审计；两条 nearby 路径共用唯一 `distanceInKm` policy。

## Spec

- [一般] `apps/web/product/application/decision/nearby-recommendation.ts:40-73`、`apps/web/product/application/decision/nearby-recommendation-operation.ts:63-99`、`apps/web/product/application/decision/nearby-transit-fallback.ts:65-77`: 路线证据仍只有 `fresh | unavailable`，没有已确认规格要求的 `stale`；因此带旧 `checkedAt` 的路线仍可被调用方标成 `fresh`，并支撑“步行 N 分钟”或“20 分钟内直达”的硬断言，回执也无法明确显示过期 warning。→ 将 walking/transit evidence 补齐 `fresh | stale | unavailable`，在 Nearby 边界用当前请求/clock 判定 freshness；stale 只保留直线距离与显式 warning，不得进入步行或直达候选，并补旧时间边界契约测试。
- [一般] `apps/web/product/application/decision/nearby-recommendation.ts:8-34`、`apps/web/adapters/providers/google-location-resolver.ts:20-73`、`apps/web/product/application/decision/agent-nearby-operation.ts:80-96`: LocationResolution 只携带 attribution label/url，没有来源核验时间；Google adapter 返回的 URL 是通用文档页而不是这次解析的可审计来源标识。resolved/ambiguous 虽已就近显示“Google Maps”，但仍无法回答“何时核验”，未完整关闭第一轮 provenance 发现。→ 为 resolved/ambiguous resolution 增加 `checkedAt`（并明确允许的 source/attribution URL 语义），由 adapter 在当前请求完成时产生；完整回执显示该时间，并覆盖唯一、歧义和距离降级场景。

其余第一轮 Spec 发现已关闭：签名 HTTP 主链使用中央 `agent.nearby` operation 并组合三态解析、fallback、EntryAccess、评分/到访及 presenter；Google Routes scope 已收敛到共享常量并由真实 policy document 契约测试；transit 使用 route 总 duration；EntryAccess 已按 policy version、HTTPS allowlist、当前时钟和最大年龄独立 fail closed。

## 验证证据

- 通过：本轮范围聚焦测试 73/73，包括签名网关、D1 并发 claim/receipt、完整 Nearby operation、Google/Foursquare/provider policy、T-03 build/preflight 与成本计量。
- 通过：新增架构适应度定向用例 1/1，确认未进入中央 catalog 的 operation group 即使声明 isolated owner 仍被拒绝。
- 通过：`git diff --check`。
- 主任务另行确认：Agent-PoC build 成功；全仓 typecheck 仅被 feature003 的两个既有 Buffer 类型错误阻断。
- T-03 仍需 Cloudflare 真实隔离资源/Secrets/部署证据；T-11 仍需实际 Foursquare API agreement、逐字段许可和真实日本校准，因此两票保持外部门阻塞，不属于本地代码缺陷。
