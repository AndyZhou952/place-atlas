# 004 OpenClaw × Japan Atlas PoC Nearby／Catalog Provider 边界增量评审

- 日期: 2026-09-13
- 评审方式: subagent
- 评审对象: `spec.md`、`architecture.md`、`tickets.md`、`docs/decisions.md`、`product/assumptions.md`、`progress.md`
- 结论: 需修改

## 发现项

- [一般] `architecture.md:53`、`tickets.md:15`：架构新增“先以 D1 中持久坐标作确定性粗筛／Top-N，再对 shortlist 调用 Routes”，但当前实现会对 `CatalogRead.list('verified_catalog')` 返回的全部 verified food 逐项调用路线（`apps/web/product/application/decision/nearby-recommendation-operation.ts:46-49,57-87`），且普通 server catalog 是 D1 动态条目与仓库内 `verifiedAtlasItems` seed 的合并结果（`apps/web/lib/server/application/server-atlas-application.ts:42-46`、`apps/web/product/application/catalog/catalog-projection.ts:17-19`），并非严格 D1-only。T-06 又已标记完成，后续票没有承接这项新算法／存储约束。未经定义的 Top-N 还可能漏掉直线距离较远但实际步行可达的条目。→ 二选一：本次澄清只保留“候选来自 Atlas Catalog、路线由 adapter 确定性计算”，删除尚未实现的 D1 Top-N 陈述；或者在规格中定义安全粗筛、上限、召回与费用边界，新增未完成 ticket 和测试后再把它保留为目标架构。
- [一般] `tickets.md:20-23,31,40-44`：T-12 已正确解除对 T-11 的依赖，可用 provider-neutral fixture 开发；但改名后的 T-11“地点发现供应商决策门”不再是任何后续 ticket 的 blocker。这样 T-14、T-21、T-22 乃至整个特性都可能仅凭 fixture 通过，而真实日用的“只输入店名 → 查找地址／评分／分店候选”仍没有获许可并启用的 provider，与 `spec.md:16,35-39,171,173-174` 的真实建档和 real-data/soak 目标不闭合。→ 保持 T-12 不依赖 T-11，但把真实供应商启用门接到 T-14（若 T-14 要测真实 provider）或最迟 T-22；T-11 应保持 vendor-neutral，Foursquare 仍只是未启用候选。
- [建议] `architecture.md:63`：成本描述仍无条件列出 “DeepSeek/Google/Foursquare 变动成本”，容易让人误读为 Foursquare 属于默认运行组合。→ 改为“已启用 provider 的变动成本”，并可在括号中注明 Foursquare 实验只有启用时计入；不影响当前边界正确性。

## 已确认一致项

- `spec.md:81-82` 明确默认只读 `verified_catalog`，Nearby 候选全集只能来自 Japan Atlas Catalog，并显式禁止 `PlaceDiscoveryProvider`、Foursquare、Places Text Search 或模型扩大候选；与 `nearby-recommendation-operation.ts:46-49` 一致。
- `spec.md:78-85`、`architecture.md:53-55`、`docs/decisions.md:191` 与 `product/assumptions.md:29` 均把位置解析和步行／电车路线事实交给确定性 adapter，并禁止 DeepSeek 生成距离、路线或排序事实；与 `LocationResolver`、`RouteProvider`、`TransitRouteProvider` ports 及 Google adapters 的代码边界一致。
- `architecture.md:56`、`tickets.md:20-21`、`docs/decisions.md:191`、`product/assumptions.md:29` 与 `progress.md:40-43` 一致把 Foursquare 定位为未启用、可替换的 Catalog intake 实验，而非 Nearby 或默认运行依赖。
- 全库运行时依赖核对未发现 Nearby／server composition 调用 `createFoursquarePlaceDiscoveryProvider`；该 factory 只在 Foursquare adapter 自身和 contract tests 中出现。因此保留现有 adapter、校准证据与 policy 测试不会把 Foursquare带入 Nearby 主链。
- `tickets.md:21` 已将 T-12 的 blocker 改为 T-02、T-05，且明确先通过 provider port／fixture 完成，不再依赖 T-11 或 Foursquare；该项满足本轮澄清。

## 结论说明

本轮已经正确修复了核心概念错误：Nearby 只对 Atlas 已录入、已验证的候选做位置和路线计算，地点发现与 Foursquare 只属于独立 Catalog intake。当前仍有两项一般问题：新增的 D1 Top-N 目标没有实现／票据承接，以及真实 Catalog intake provider 门从 ticket 依赖图中脱落。关闭这两项后可复审通过。
