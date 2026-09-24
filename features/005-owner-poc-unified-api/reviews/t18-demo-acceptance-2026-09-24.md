# T-18 演示验收 — 2026-09-24

- 模式: interactive
- 验收人: Owner
- 结论: 接受
- 用户确认: 2026-09-24（“回复正常”）

## 真实微信流程

Owner 在真实微信 DM、OpenClaw plugin 0.3.1 上完成：

1. `/jpmap add 東京タワー` 返回一个带 Google Maps 来源的候选；
2. `/jpmap add select 1` 返回 `保存前预览`；
3. preview 展示 Google Place identity、Owner query 名称、durable-geocoder
   地址与坐标、OpenStreetMap 来源／ODbL license／核验时间，以及
   Tabelog、预约仍为 unknown 的明确提示；
4. `/jpmap add cancel` 返回本次 Add 已取消，没有发布测试地点。

该结果关闭 0.3.0 固定四秒 deadline 暴露的真实渠道回归。0.3.1 的
operation-aware deadline、Add-specific failure reply、生产签名探针与真实微信
delivery 已形成完整验收链。

## 范围边界

- Research Relay 继续为 `relay_disabled_manual_unknown`；Tabelog 与预约 unknown
  是当前基础 Add 的已接受退化，不冒充已完成研究。
- DeepSeek 模糊语义属于 T-09；Record 总体/逐图评价与多图会话属于 T-19/T-20，
  不并入本票。
