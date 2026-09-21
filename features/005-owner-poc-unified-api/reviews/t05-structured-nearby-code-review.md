# T-05 结构化 Nearby 代码评审（第 1 轮）

- 日期: 2026-09-21
- 评审方式: subagent
- 固定点: `b201a3c5887bdda8d2a71be732f511b035a8998a`
- 范围: 仅 T-05 未提交变更；排除 `apps/web/route-sidecar/`、`wrangler.route-sidecar.jsonc`、T-06 scripts/runbook/package-only 变更与 `.orig`
- 结论: 需修改

## Standards

- [建议] `apps/web/product/application/conversation/nearby-wechat-presenter.ts:30`: `toReceiptCandidate` 只原样返回入参，是一层无行为的 Middle Man，而且两套 candidate/receipt 类型重复描述同一形状 → 在保持微信呈现属于 Conversation 的前提下，直接传入已闭合的 recommendations，或只保留一个共享的 presenter input contract。

## Spec

- [一般] `apps/web/product/application/decision/agent-nearby-operation.ts:177`: `attribution`、`provenance`、route `source` 和 Personal Memory `facts` 被原样挂到宣称闭合的 `NearbyRecommendResult`；TypeScript 结构类型不会在运行时删除额外字段。独立 sentinel probe 已证明 provider 对象中的 `replyText` 与 `latitude` 会穿透 Application result，随后被 Browser API 直接序列化；现有“closed”测试只使用没有 sentinel 的正常 fixture，因此未覆盖该失败路径。这不满足 T-05 对渠道中立闭合 DTO 以及 core/browser 不返回坐标或 `replyText` 的要求 → 对所有嵌套对象做明确 allowlist projection（至少 attribution、provenance、route source 与 visit facts），并用携带额外 `latitude`/`longitude`/`replyText`/sentinel 字段的 ambiguous、unresolved、resolved fixtures 同时覆盖 Application operation 与 Browser HTTP 响应。

## 独立验证

- T-05 聚焦 contract/integration tests: 38/38 通过。
- 架构适应度套件: 62/62 通过。
- `npm run typecheck`: 通过。
- T-05 定向 `oxlint`: 通过。
- T-05 定向 `oxfmt --check`: 18/18 文件通过。
- 能力边界复核: Browser `nearby.recommend` 无 capability；Agent read manifest 仍只有 `jpmap_nearby`，未开放个人写入、Add、Record 或 destructive operation。
- 业务事实复核: Owner composition 使用 `atlas_items` 与规范 Personal Memory；`agent.nearby` 仅保留在有意的历史审计 fixture，新审计键为 `nearby.recommend`。
