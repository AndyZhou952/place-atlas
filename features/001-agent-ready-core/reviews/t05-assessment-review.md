# T-05 PlaceAssessment 与 D-009 切片代码评审 (第 1 轮)

- 日期: 2026-09-12
- 评审方式: subagent
- 固定点: `3cca673` + working-tree fixed snapshot, no checkpoint commit
- 结论: 通过
- 验证: T-05 定向自动测试 17/17、全量测试 105/105、typecheck、lint、format check、build 与 `git diff --check` 均通过；另以独立故障注入确认 state save 失败返回脱敏 `dependency_failure`。

## Standards

- [建议] `apps/web/product/application/assessments/place-assessment.test.mjs:179-209`: `failingState.read()` 先抛错，因此同一 fixture 中同样抛错的 `save()` 永远不会执行；当前实现已正确脱敏 save failure，但自动化回归只锁定了 read failure。→ 拆成 read-failure 与 save-failure 两个 state fixture，后者先成功返回 context 再让 `save()` 抛错，分别断言闭合错误和无内部细节。

## Spec

- 无。`assessment.update` 保持 0–5（含 0/5）与一位小数归一、rating/喜欢/manualVisited/summary 独立更新及 rating/summary 清除；完整 `manualVisited × Visit count` 真值表同时覆盖 mutation 返回与后续 Catalog read。D1 adapter 将旧 `has_visited` 封装为 `manualVisited`，personal HTTP adapter 仅映射旧 `hasVisited` 名称并保持 JSON shape/400/404/500，核心与 adapter 错误均脱敏。本票未创建 Visit，也未引入 APP-02、鉴权、Trash 或 migration 行为；中央 composition 共享同一 `CatalogRead`，并显式注入 D1 state 与 clock。
