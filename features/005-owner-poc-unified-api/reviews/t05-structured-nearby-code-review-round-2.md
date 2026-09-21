# T-05 结构化 Nearby 代码评审（第 2 轮）

- 日期: 2026-09-21
- 评审方式: subagent
- 固定点: `b201a3c5887bdda8d2a71be732f511b035a8998a`
- 复审范围: 仅第 1 轮 Spec 轴闭合 DTO 阻断项；不重开非阻断建议，排除 T-06/route-sidecar 与 `.orig`
- 结论: 通过
- 用户确认: 2026-09-21（用户指示继续）

## Standards

本轮修复未引入新的 Standards 问题。新增 projector 小而明确，将运行时输出边界集中在 Application operation 内，没有把渠道文案或 HTTP 细节收回核心。

## Spec

无发现项。第 1 轮阻断已关闭：

- `apps/web/product/application/decision/agent-nearby-operation.ts:171` 的 ambiguous、unresolved 和 resolved 三个分支均通过显式 projector 构造 attribution/provenance，不再返回 provider 对象引用。
- `apps/web/product/application/decision/agent-nearby-operation.ts:266` 对 walking/direct-transit route source 使用相同的 attribution projector，并对 Personal Memory facts 只 allowlist `manualVisited`、`visitCount`、`latestVisitAt` 与 `personalRating`。Entry Access 仍先经已有 normalizer 生成闭合 assertion。
- Core contract 将 `latitude`、`longitude`、`replyText` 和 `__sentinel` 注入 location attribution/provenance、route attribution、Personal Memory facts、ambiguous candidate 及 outcome，并证明 resolved/ambiguous/unresolved 结果都不泄漏。
- Browser HTTP contract 用真实 `AtlasApplication` 依次序列化 ambiguous、unresolved 和 resolved 三类 poisoned outcome，证明 HTTP JSON 中不含坐标字段、`replyText` 或 sentinel，同时保留规范 route source 与 visit facts。

## 独立验证

- Core + Browser sentinel focused tests: 9/9 通过，exit 0。
- `npm run typecheck`: 通过。
- Round-2 定向 `oxlint`: 通过。
- Round-2 定向 `oxfmt --check`: 4/4 文件通过。
- 本轮没有修改被评实现，只新增此评审结论。
