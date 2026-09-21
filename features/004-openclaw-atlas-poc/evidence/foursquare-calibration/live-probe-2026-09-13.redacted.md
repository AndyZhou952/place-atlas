# Foursquare Places API New — 脱敏实测探针

- 时间：2026-09-13
- 目的：验证用户提供的隔离 Service API Key 与当前 Places API New wire shape；不是性能基准，也不是 provider 上线批准。
- 请求：一次 `GET /places/search`，API version `2025-06-17`，使用日本餐厅名、东京 locality 与 `limit=3`。
- 结果：HTTP 200；返回 3 个候选。
- 所需字段：`fsq_place_id`、`name`、`location.formatted_address`、顶层 `latitude`、顶层 `longitude` 均存在。
- 协议差异：当前响应不含旧版 `geocodes.main`；mapper 与合成 regression fixture 已改为当前顶层坐标结构。
- 数据卫生：未保存原始响应、请求 header、Service API Key、账号标识或真实地点 ID；仓库 fixture 全部为合成值。
- 费用计数：本探针消耗 1 次 Places API 调用；PoC 应用门继续使用 warn=400、hard=500，达到 hard gate 后失败关闭。

## 尚未解除的上线门

Provider policy 继续保持 `pending_review`。在启用产品侧网络请求或把任何 Foursquare 字段写入 D1 前，仍需保存账号实际适用协议、逐字段 read/chat/durable/Leaflet 结论、Service Key 限制能力证据、usage/billing 导出与 attribution fixture。`rating` 继续是 `unknown/not_permitted`。
