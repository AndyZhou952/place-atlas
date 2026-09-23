# 004 OpenClaw × Japan Atlas PoC Nearby／Catalog Provider 边界增量评审（第 2 轮）

- 日期: 2026-09-13
- 评审方式: subagent
- 评审对象: `spec.md`、`architecture.md`、`tickets.md`、`docs/decisions.md`、`product/assumptions.md`、`progress.md`
- 结论: 通过

## 发现项

- 无。

## 第 1 轮发现闭环

- D1／内置 Catalog 与路线粗筛：`architecture.md:53` 现已准确区分当前小型 PoC 的逐候选 Routes 行为和真实批量数据前的目标优化；`tickets.md:16` 新增未完成的 T-06A，明确承接 repo seed 迁入 D1 或内置 Catalog 定义、持久坐标粗筛／Top-N、Route Matrix、少量电车 fallback，以及调用次数、延迟和预算测试。该描述不再把尚未实现的优化误写为当前代码事实，也不再由已完成的 T-06 冒充交付；首轮一般发现已关闭。
- 真实地点发现供应商门：`tickets.md:22` 保持 T-12 仅依赖 T-02/T-05，可用 provider port／fixture 独立实现；`tickets.md:24` 现让真实微信餐厅建档 T-14 同时依赖 vendor-neutral T-11 与 T-13，因此 fixture 开发不被 Foursquare 阻塞，而真实“只输入店名”链路不能绕过供应商许可、数据质量与启用门；首轮一般发现已关闭。
- 成本措辞：`architecture.md:63` 已改为 DeepSeek 与“已启用地点／路线 provider”的变动成本，不再暗示未启用 Foursquare 是默认运行成本；首轮建议已关闭。

## 一致性复核

- `spec.md:81-82`、`architecture.md:53`、`docs/decisions.md:191`、`product/assumptions.md:29` 一致规定 Nearby 候选全集只来自 Japan Atlas 已录入且已验证的 Catalog 条目；不得由 Foursquare、Places discovery 或模型扩大候选。
- `spec.md:78-85`、`architecture.md:53-55` 与 D-P03 一致把位置解析、步行／电车距离和路线判断交给确定性 adapter，DeepSeek 不决定距离、行程或排序。
- `architecture.md:56`、`tickets.md:21-24`、D-P03、A-29 与 `progress.md:40-43` 一致把 Foursquare 保留为未启用、可替换的 Catalog intake 实验；它不是 Nearby 或默认建档运行依赖。
- T-12 已解除对 T-11 的实现期依赖；T-14 则恢复真实供应商门，ticket graph 同时满足 provider-neutral 开发与真实 E2E 失败关闭。
- 当前代码事实与文档阶段描述一致：Nearby 从 `CatalogRead.list('verified_catalog')` 过滤 verified food 后逐项调用路线；普通 catalog 当前合并 D1 动态条目与内置 verified seed；Foursquare factory 未被 Nearby 或 server composition 调用。T-06A 明确承接未来批量目录的存储边界与路线调用优化。

## 最终结论

上一轮两项一般发现和一项建议均已关闭。澄清后的规格、架构、决策、假设、票据与进度现在一致表达：Nearby 只查询 Atlas Catalog，路线由应用确定性调用 adapter，Foursquare 仅为未启用的可选 Catalog intake 实验，T-12 不依赖 T-11，而真实餐厅建档仍需通过 vendor-neutral T-11。未发现新的严重或一般问题。
