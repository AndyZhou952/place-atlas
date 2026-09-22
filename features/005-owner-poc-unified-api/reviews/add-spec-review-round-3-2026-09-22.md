# Add 增量规格评审（第 3 轮 closure）

- 日期: 2026-09-22
- 评审方式: subagent
- 结论: 需修改（Needs changes）

## 评审范围

只复核第 2 轮的三个主要缺口、两个 subsidiary details，以及 `tickets.md`、`progress.md`、`product/assumptions.md` 一致性；不重新评议用户已确认的 Tabelog Agent-first 产品选择。

## 剩余 blocker

- [一般] `spec.md:102,157`、`tickets.md:29`、`product/assumptions.md:A-48`: 用户确认并记入 A-48 的硬预算是**整条 intake 总计** `1 search / 5 pages / 60s`，第 2 轮也明确要求在保持该总预算不变时为 confirm 预留额度；修订稿却改成 initial 和 confirm 各 `1/5/60s`，全会话 `2/10/120s`，直接把已确认总预算翻倍。→ 在已确认的 `1/5/60s` 内切分阶段保留量（例如 initial `1 search + 3 pages`，confirm `0 search + 2 pages`，每 request 仍 15s/3 redirects），或先取得用户明确批准再同步 A-48；spec、ticket、test fixture 与假设台账必须只有一个总预算。

- [一般] `spec.md:130,134`: 第 2 轮要求闭合的 `titleProposal`、`addressProposal`、`clarification`、`suspectedDuplicates`、`unknownFields`、`warnings` 仍只有字段名，没有 shape、长度、上限或允许内容；`select` 的 `clarification` output 也引用同一未定义结构。因此“闭合 Add DTO”仍允许 adapter 各自发明 payload，第三方无法对 Web/Agent 等价性给出唯一通过/失败判断。→ 为这些字段补齐 discriminated unions/list item schema、数量与文本限制；若 PoC 不需要某字段则删除，不能以未定义对象留在 closed DTO。

- [一般] `spec.md:181`、`progress.md:31,34-35`、`product/assumptions.md:A-47..A-49`: spec 已正确澄清仅 A-48/Tabelog 是用户确认，A-47/A-49 是生效技术默认；但 progress:31 仍以“用户确认并细化 Add 产品方向”总括 Google/OSM durable-location 与确定性 session/product key，和 spec:181 的权威级别不一致。→ 将 progress:31 拆开：用户确认只指向 A-48 产品选择；A-47/A-49 写为 review 后生效、待架构确认的技术默认。tickets 已与当前技术默认一致，无需改其业务内容。

## 已关闭项

- 仅名称 Add 已可从 Owner query 形成 title/location proposal；Owner overrides 改为可选，无 durable evidence 时有 clarification 或 `needs_review`，且不借 Google transient content 持久化。
- Owner coordinates、LatLng 范围、location evidence、source URL 可选语义、operation result/error 与 confirm 五路 outcome 已补齐；剩余仅是上述少数嵌套展示 DTO 尚未闭合。
- `preview_ready → preview_ready` refresh-conflict self-transition与版本递增已写入状态表；refresh failure 保留相同历史 scalar、stale warning 且不更新时间，因此相同失败再次确认不会产生新 digest，具备有限终止路径。
- spec 已把 A-47/A-49 标成技术默认而非用户逐项确认；只有 progress 的旧总括句仍需同步。

## 结论说明

第 2 轮的核心设计方向均已闭合，剩余三项均为局部规格/台账一致性修订。修正后可进行一次短 closure 复核；无需改变 Tabelog 产品选择、Google/Leaflet 边界、Add mutation key 或 UI 设计。
