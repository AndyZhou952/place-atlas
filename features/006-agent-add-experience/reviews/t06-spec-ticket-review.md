# T-06 个人评分／Tabelog 回归增量评审
- 日期: 2026-09-24
- 评审方式: subagent
- 结论: 需修改
## 发现项
- [一般] `tickets.md` T-05/T-06 的 `Blocked by`：AC26–28 已把该回归纳入 Feature 006 验收范围，T-06 本身 `Blocked by: None` 也与现有 Personal Memory ↔ Catalog 投影接缝兼容；但最终整体验收 T-05 仍只依赖 T-01–T-04。当前图允许 T-05 在 T-06 未修复／未验收时先关闭，从而在不满足新增规格的情况下完成 Feature 006。 → 将 T-06 加入 T-05 的 `Blocked by`（或者把最终验收拆出一张同时依赖 T-05 和 T-06 的收口票），并在整体回归中运行 AC28 的 mutation response → 即时 ViewModel → reload/Catalog read-back 链。
