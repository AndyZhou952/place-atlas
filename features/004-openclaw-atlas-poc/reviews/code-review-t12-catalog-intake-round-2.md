# T-12 Catalog intake discovery 实现评审（第 2 轮）

- 日期: 2026-09-15
- 评审方式: subagent
- 固定点: `HEAD` (`df2ec5958e974debca70b27b977662fd75cb7b87`)，复审原四个新增文件及新增 `catalog-intake-review-repairs.test.mjs`
- 结论: 需修改

## Standards

- 无发现项。Round 1 的重复 search policy 已关闭：coordinator 复用唯一 owner `decision/search-policy.ts` 的 `normalizeSearchText`，production architecture audit 不再报告 `catalog-intake-coordinator.ts` 的 `duplicate_business_policy`。

## Spec

- [一般] `apps/web/product/application/catalog-intake/catalog-intake-coordinator.ts:382-393`: 分店／区域修复只闭合了 evidence 与多候选摘要；单候选或选择后的 preview 仍把 `presentation.area` 固定为 `unknown`，并无条件把 `area` 放进 `unknownFields`。评审者用已许可、带 provenance 的 `area = 中央区銀座` 最小复现，得到 `evidence.area.status = known`，但 `presentation.area.status = unknown`，用户预览会隐藏已经取得的区域且自相矛盾，不符合“预览至少显示区域”。→ 从 immutable evidence 投影 preview area；known 时显示值并移出 `unknownFields`，unknown 时保持现状，同时补单候选和 selection→preview 两条回归测试。

## Round 1 关闭情况

- 已关闭: cancelled session 的新 discover 重放 `cancelled`，Catalog/provider 调用计数不增加。
- 已关闭: 空白 name/address 在 Catalog/provider 前返回 `invalid_input`；空白可选 near 被省略。
- 已关闭: durable coordinates 不再隐含第三方地图许可；只有显式 `mapPresentation` 与有效 attribution 才生成 OpenStreetMap 深链，否则为 unknown。
- 部分关闭: branch/area 已进入 provider-neutral evidence 与最多三个候选摘要，但上述 preview area 仍错误隐藏。
- 已关闭: 弱匹配使用唯一 search policy owner；未发现第二套归一化实现。

## 其他规格核对

- 强 identity 自动复用、弱名称／地址／近坐标只提示不合并，多候选选择绑定已存 candidate ID 且不重新搜索。
- evidence snapshot、digest、preview version 与 catalog revision 仍绑定且冻结；未注入、导入或调用 `CatalogWrite`，本切片没有地点写入路径。
- 未获许可 rating 保持 unknown；known rating 仍要求 durable 字段许可、来源 URL、核验时间及可选评论数许可。

## 验证记录

- 通过: T-12 focused、Round 1 repairs、Foursquare contract/calibration 与 provider-policy regression，共 20/20。
- 通过: 五个固定范围文件的 `oxlint` 与 `oxfmt --check`。
- production architecture fitness 已重跑；Round 1 的 T-12 duplicate policy 违规消失。当前仅剩并行工作区中 `agent.nearby` 的三项组合违规，不归属 T-12。
- 范围说明: 唯一 search owner 的修复依赖 `apps/web/product/application/decision/search-policy.ts` 一行导出变更；该文件不在本轮固定实现范围，复审仅核对该依赖事实，未修改它。
