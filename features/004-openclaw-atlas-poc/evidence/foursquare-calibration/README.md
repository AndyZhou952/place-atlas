# Foursquare 离线校准（未启用）

这些 fixture 仅验证 Places API New 的封闭字段映射、稳定 identity、零／一／多候选和 malformed/error abstain。地点名称、ID 与地址均为合成的日本格式样本，不是实测 API 响应、覆盖率或分店质量证据。

当前 Foursquare provider policy 保持 `pending_review`。缺少实际 API agreement、逐字段 read/chat/durable/Leaflet 权利结论、service-key restriction evidence 和账单／配额告警导出；因此 adapter 必须 fail closed，禁止网络请求、provider 启用或任何 `verified` 结论。`rating` 继续为 `unknown/not_permitted`，不因 raw fixture 含有同名字段而改变。

真实 API agreement 与已批准隔离凭证就绪后，重新运行这组 mapper fixtures 之外的受控 provider contract／日本标注集，再由独立 reviewer 更新一份新的 policy evidence 版本；不得修改本文件或把真实 provider response、key、account ID 或用户数据写入仓库。
