# Agent Add 体验与 Creator Import 收缩任务票评审 (第 1 轮)
- 日期: 2026-09-24
- 评审方式: subagent
- 结论: 需修改
## 发现项
- [一般] `T-02` 与 `T-03` 的切片／依赖关系：T-02 要先删除 browser mapping/client/state，但当前 Inbox View/Workspace 仍依赖 `importJobs` 与 `queueImport`；T-03 才删除这些 UI，却被标为 `Blocked by: T-02`。因此 T-02 单独完成时无法保持 typecheck/build 可验收，不是一个可独立收绿的垂直切片。 → 将 Review UI/ViewModel 先做扩张切换，再让运行时收缩票依赖它；或把 UI、browser state/client 与运行时删除合并为一张端到端收缩票。若坚持两票并行，需在 T-02 中明确可编译的过渡 adapter 及其在 T-03 的当轮删除门，不得留下可部署的旧入口。
- [一般] `后续 Backlog` 第 9–11 行：B-01 的文字边界已明确禁止 Feature 006 实现 Screenshot-to-Add，但它仍以与当前 T-01–T-05 相同的未完成 checkbox 和 `Blocked by` 格式放在本特性 `tickets.md` 中；机械的 progress/hf-ship 检查会把它视为本轮尚未完成任务，也无法从格式上保证实现 agent 不会领取。 → 将 B-01 改为非 checkbox 的 `Deferred/backlog reference`（最好链接独立 backlog/GitHub issue），并明确它不属于 Feature 006 的完成条件、实现波次或 blocked-by 图；保留“不得恢复 Creator Import／跳过 confirm／新增任何 ingestion 代码”的限制。
