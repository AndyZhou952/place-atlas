# 004 OpenClaw × Japan Atlas PoC 命令路由与到店可用性增量规格评审（第 3 轮）

- 日期: 2026-09-13
- 评审方式: subagent
- 结论: 通过（pass）

## 发现项

- 无严重、一般或建议发现。

## 第 2 轮 finding 关闭核对

- `spec.md:67,70-71,146-147,155,164` 已把 bare alias 与连续 capture 从有已知缺陷风险的 `before_agent_reply` 移到代码自有、位于 OpenClaw agent loop 之前的 `PreModelIngressRouter`，并把该入口本身纳入真实 AWS＋腾讯微信 capability probe 与 Write gate。规格不再把 OpenClaw 2026.7.1 的 hook 行为当作已保证能力。
- capability gate 关闭时的外部结果已闭合：系统不得创建 active capture；bare `jpmap`、`jpmapx` 和普通文字均可进入无项目凭证／工具的普通助手，项目工具调用和项目状态变化必须为零。`feature.md:44,54`、`product/assumptions.md:A-27` 与此一致，不再要求这些未认领路径模型调用为零。
- capability gate 开启时的外部结果已闭合：ingress router claim 严格 bare alias、bare 相似前缀防火墙和 active capture 内容；相似前缀返回固定帮助，普通聊天不 claim。`capturing`、`paused`、`ready_to_commit` 及终态继续受既有 capture 状态表约束，其他已登记项目命令不改变 Atlas capture 状态或计时。
- 规范 slash 路径与 bare 路径已经分层：平台先消费保留 slash 命令，`/jpmap` 再由 OpenClaw command layer 的 direct-dispatch skill 处理；未知 slash 即使进入普通助手，也不取得项目凭证／工具且不能改变项目状态。上一轮关于平台保留命令的建议已关闭，并已加入平台保留／未知 slash 的验收覆盖。
- 测试门已按 capability gate × 输入类别形成明确矩阵：规范 `/jpmap` 和 gate 开启时被 ingress claim 的路径要求模型调用为零；gate 关闭时 bare 路径允许普通模型，但项目工具调用和状态变化为零；凭证及状态不得跨项目串用。

## 结论说明

第 2 轮唯一一般 finding 已关闭，上一轮平台 slash 建议也已落实。当前增量规格明确区分受 OpenClaw direct-dispatch 保证的规范命令、经真实链路探针后才启用的 pre-model 便利能力，以及 gate 关闭时无项目能力的普通助手路径；没有发现新阻塞，可以进入特性架构阶段。
