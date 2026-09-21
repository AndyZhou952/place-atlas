# T-07 Nearby Web/Agent/Sidecar 独立代码与 UI 评审

- 日期: 2026-09-21
- 评审方式: 独立 subagent 冷读；评审者未修改被评代码
- 最终结论: PASS

## 首轮发现与关闭

1. Browser Nearby 的 request-only 路线证据与个人事实响应缺少显式 `Cache-Control: no-store`。实现已统一覆盖成功与错误响应，并增加合同测试。
2. ambiguous、unresolved 或失败的新查询可能继续显示并按上一次位置的距离排序。实现已在任何新查询分支前清空旧距离，并增加回归合同。

测试按 red-green 顺序证明两项缺陷：修复前聚焦测试出现 3 个预期失败，修复后 14/14 通过。

## 最终结论

- Browser 与 Agent 使用同一结构化 Nearby operation，候选、路线、个人事实、warning 与 attribution 等价。
- Agent read effect 保留 HMAC、owner/channel/scope/nonce/audit，但不把瞬时 Nearby 结果写入 mutation receipt。
- Sidecar 输入与 provider 原始数据不进入 D1、R2、日志、prompt 或 Leaflet。
- Owner Worker 配置和构建产物都只含一个精确私有 Sidecar binding；公开 Terms/Privacy 和 UI 多视口证据通过。
- `no-store` 与当前查询距离一致性修复复审通过，未发现新的阻塞项。

本结论关闭 T-07 代码/UI 门，不替代 T-06 的单次真实 provider smoke，也不批准永久 OpenClaw 切换。
