# T-08 Nearby 本地 E2E 代码评审

- 日期：2026-09-22
- 评审方式：subagent
- 固定点：`HEAD 7e6bdb5cb5cfe28a8570fdc3aeda6a0e12304d91`
- 范围：仅新增 T-08 harness、contract test 与本地/远端只读证据；并行 T-12 代码排除
- 结论：**通过（PASS，仅限本地代码门；T-08 任务仍未完成）**

## Standards

未发现严重或一般问题。harness 穿越真实 native plugin handler、签名 HTTP adapter、HMAC/owner/channel/scope/nonce gateway、router、`AtlasApplication nearby.recommend` 与微信 presenter，只在外部 Nearby provider 使用确定性 fixture；第二账号／群聊在 Worker egress 前失败，wrong-scope 和 nonce replay 则穿越真实 gateway 负路径。

- 新增 T-08 与相邻 gateway tests：**10/10** 通过。
- pinned OpenClaw plugin tests：**11/11** 通过。
- 当前 TypeScript、全仓 lint 与 format-check：全部通过。
- **[建议] `evidence/t08-owner-poc-nearby-e2e-2026-09-22.md:17` 仍写“全仓 lint 被并行 T-12 两项诊断阻塞”，已被本轮全仓 lint 通过的结果取代；后续整理证据时改成当时状态或当前结果，避免 `currently` 造成歧义。**

## Spec

本地范围通过：`银座/銀座/ginza` 均走确定性 `/jpmap nearby`，harness 模型计数为零；Owner DM 产生三条 `nearby.recommend/success` audit；第二账号和群聊零 Worker egress；wrong scope 为 403、nonce replay 为 401，且 provider 不重复执行。测试未修改部署、endpoint、D1 或运行时 manifest。

本结论**不等于 T-08 完成**。证据如实保留 live blocker：Lightsail SSH 拒绝连接，因此尚无当前真实微信 Owner/第二账号/群聊 probe、installed-runtime 零模型证据，以及与本次 `nearby.recommend` 对应的线上 Worker audit。`tickets.md` 中 T-08 必须继续未勾选，T-11 也继续受其阻塞。
