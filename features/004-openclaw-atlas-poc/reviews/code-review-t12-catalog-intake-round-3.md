# T-12 Catalog intake discovery 实现评审（第 3 轮）

- 日期: 2026-09-15
- 评审方式: subagent
- 固定点: `HEAD` (`df2ec5958e974debca70b27b977662fd75cb7b87`)
- 审查对象: T-12 Catalog intake 固定范围、`catalog-intake-review-repairs` 回归测试，以及唯一 shared search-policy export 改动
- 结论: 通过
- auto-approved 2026-09-15

## Standards

- 无一般或严重 finding。Catalog intake 继续调用 `decision/search-policy.ts` 的唯一 `normalizeSearchText` owner，未重新引入归一化 policy；静态检查也未发现 `CatalogWrite`、D1/R2 或 SQL 写入路径。此切片仅写入 `CatalogIntakeStore` 的 session/preview 状态，未创建或发布 AtlasItem。
- 已通过范围内 `oxlint` 与 `oxfmt --check`（coordinator、place-discovery、三份 Catalog intake test 及 search-policy export）。

## Spec

- 无一般或严重 finding。第 2 轮唯一 area finding 已关闭：`createPreview` 从 immutable evidence 投影 `presentation.area`；已许可且含 provenance 的 known area 显示其值，且不会出现在 `unknownFields`。该共享 projection 同时适用于单候选与 selection 后 preview。
- 缺失或 provider 映射为 unknown 的 area 仍显示 `unknown` 并列入 `unknownFields`。可选字段若以 known 形式绕过字段许可进入 coordinator，会在 `hasDurableEvidence` 前置校验中失败关闭，不会生成或泄露 preview；正常 provider policy 映射未获许可字段为 unknown。
- 第 1 轮其余 finding 未回归：取消的 session ID 终态重放且不再 provider egress；空 name/address 在 Catalog/provider 前返回 `invalid_input`、空 near 被省略；coordinates 只有明确 map presentation permission 与 attribution 才生成地图链接；最多三个同名候选继续显示有来源的 branch/area。
- 强 identity 复用、弱匹配仅提示、immutable evidence/digest/version/revision、外部评分的许可/provenance 与无地点写入边界均维持符合 T-12。

## 验证记录

- 本人运行 focused Catalog intake、Foursquare discovery contract 与 provider-policy regressions：31/31 通过。
- 覆盖包含 permitted known-area presentation（不含 `unknownFields.area`）、缺失 area 的 unknown presentation、取消、空白输入、地图许可、branch/area selection summary、rating provenance、provider field policy、DNS/redirect/SSRF 与 quota fail-closed。
- 独立读取当前工作树中该固定范围的全部 source/test 文件；工作树另有并行未提交变更，未将其纳入 T-12 结论。
