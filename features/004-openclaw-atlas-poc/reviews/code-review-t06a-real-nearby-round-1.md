# T-06A Real Nearby / Google Route Matrix 代码评审（第 1 轮）

- 日期: 2026-09-15
- 评审方式: subagent
- 固定点: `HEAD`；本票文件相对固定点均为新增或未提交修改
- 结论: 通过
- auto-approved 2026-09-15

## Standards

- 未发现严重、一般或建议项。
- 独立重跑 T-06A 聚焦契约测试：8/8 通过。
- 独立重跑全部相关 Nearby 与 Google provider 回归：40/40 通过；覆盖 verified food 坐标粗筛、稳定 Top-N、并发请求合并为单次 walking matrix、单 element 与整请求失败关闭、walking 层存在时零 transit、walking 层为空后的 transit 上限、15 分钟/2 公里/20 分钟边界与三语 Location Hint。
- 固定范围 `oxlint` 与 `oxfmt --check` 通过。全仓 `npm run typecheck` 执行过但被范围外 `scripts/migration-packaging.ts:81,124` 的并行 Buffer 类型错误阻断；编译器未报告本票文件错误，因此该范围外故障不改变本票结论。
- 并发 batching 的状态按 provider instance 隔离、按 origin 分组，并在每个 request microtask 内结算；失败路径都会完成所有 pending Promise，没有悬挂请求或供应商正文泄漏。
- 未发现神秘命名、重复代码、数据泥团、基本类型偏执、重复条件、霰弹式修改、发散式变化、夸夸其谈的通用性、消息链、中间人或被拒绝遗赠达到需要记录的程度。

## Spec

- 未发现严重、一般或建议项。
- `NearbyRecommendation` 仍是产品核心决策缝；Google SDK/请求形态留在 adapter，符合 Ports & Adapters 方向。
- shortlist 只接受 `verified` 的 `food`，使用 Catalog 持久坐标计算直线距离，以距离后 item ID 稳定排序；无效坐标和无效配置失败关闭，路线查询只发生在 Top-N 上。
- walking matrix 使用一个 origin、多个 destinations；生产 field mask 包含 `originIndex,destinationIndex,status,condition,distanceMeters,duration`，并限制每批最多 625 elements。响应 mapper 按 destination index 恢复乱序结果，重复/缺失/越界/畸形 element 使整批失败关闭，明确 route failure 只使对应 element unavailable。
- transit 只由既有 Nearby core 在 walking recommendation 为空时调用；T-06A wrapper 对真实 provider egress 单独计数并限制在最近的 transit shortlist 内，超限候选返回 unavailable 而不出网。既有 fallback 继续强制门到门 `<=20:00`、单一线路与零换乘。
- `银座`、`銀座`、`ginza` 均作为原始 Location Hint 直接送入确定性的 Google resolver，并同时设置 Japan region bias 与 `country:JP` restriction；模型不参与坐标或路线判断。
- Google 字段只声明 request/chat 使用、cache 为 `request_only`，credential scope 为 `routes.compute`，attribution 要求 `Google Maps`；与版本化 provider policy 的既有 scope、origin、字段和缓存约束一致。
- 本轮固定范围不含真实 HTTP transport、raw mapper registry、中央 composition、Cloudflare secret 或部署。因任务票明确由主任务负责汇合，这些不是本轮缺陷；在 T-06A 标记完成或真实微信 gate 前，仍须把 raw matrix mapper 接入 transport、以 pending policy 的部署证据激活 policy，并完成真实 API/成本证据。
