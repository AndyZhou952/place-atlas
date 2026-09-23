# Add 增量规格评审（第 4 轮 closure）

- 日期: 2026-09-22
- 评审方式: subagent
- 结论: 需修改（Needs changes）

## 评审范围

仅核对第 3 轮三项：总预算与 phase reserve、nested DTO 闭合、progress/assumption status。

## 剩余 blocker

- [一般] `spec.md:126,130,134`: nested DTO 的结构与枚举已经补出，但第 3 轮明确要求的数量/文本限制仍未完全闭合。`Clarification.prompt`、`Warning.message` 没有长度上限；`suspectedDuplicates`、`unknownFields`、`warnings` 与 `Clarification.fields` 没有最大项数/唯一性规则。`TitleProposal.value`/`AddressProposal.value` 可合理复用 line 126 的 title/address 限制，但上述 prompt/message/list 仍允许 adapter 产生无界或重复 payload，Web/Agent 等价 contract 不能唯一判定。→ 为 prompt/message 指定明确 Unicode 长度并沿用 NFC/control-character 规则；为四个数组指定 max、去重/顺序规则（`suspectedDuplicates` 宜沿用既有最多 3 项），并在 DTO contract fixtures 中覆盖边界。除此之外不需要改变 union 内容。

## 已关闭项

- research 总预算已统一为全会话 `1 search / 5 pages / 60s`；initial `1+3+35s` 与 confirm `0+2+25s` reserve 不可互借，spec、tests、T-12 与新增 A-50 一致。A-48 只记录用户确认的产品选择，不再把技术预算误称为逐项确认。
- nested DTO 的 discriminated structure、allowed codes、LatLng、evidence、operation success/error 与 source mapping 已闭合；只剩上述 boundedness 缺口。
- progress 已把用户确认的 Tabelog 产品方向与 A-47/A-49/A-50 生效技术默认分开，和 spec/assumptions/tickets 一致。

## 结论说明

预算和状态台账两项已关闭；nested DTO 还差一处机械性边界约束。补齐后可直接做最终短复核，无需回到产品讨论或更改架构方向。
