# 云端 Agent Handoff — 003 生产快照与 T-14 解锁

把以下内容作为云端 Agent 的首条任务提示。仓库内文档是真实来源，聊天记录不是。

## 提示词

你将继续开发私有仓库 `AndyZhou952/jp-food-event-map` 的特性 003。先用 CLI fetch，并切换到远端分支 `codex/t14-production-snapshot`；禁止在 `main` 或错误分支上工作。确认本地 `HEAD` 与 `origin/codex/t14-production-snapshot` 一致后再开始，不使用网页界面进行 Git commit/push。

先完整读取 `/CONTEXT.md`、`/product/architecture.md`、`/product/assumptions.md`、`/docs/decisions.md`、`/docs/maintenance.md`，以及 `/features/003-production-snapshot/` 下的 `feature.md`、`spec.md`、`architecture.md`、`tickets.md`、`progress.md` 和最终通过的 review。使用已安装的 `hf-workflow` 恢复状态；本特性是 build + auto。到达 implement 时使用 `hf-implement` 与 `hf-tdd`，实现任务必须交给 subagent，评审必须由未编写该对象的独立 subagent 按 `hf-review` 完成。

从 `tickets.md` 的前沿票开始，严格遵守 blocked-by 和并行波次。每张票坚持红→绿：先在架构已确认的 seam 写一个会失败的行为测试，再写最小实现；同一 Agent 完成该票的测试和实现。每票完成后由独立 reviewer 执行 Standards + Spec 双轴代码门，修复所有严重/一般 finding 后才勾选。主 Agent 负责波次汇合、全量 `format:check`、lint、typecheck、test、build、CLI commit 和 push；定期把进度、测试证据、review 结论写回仓库，不依赖聊天记忆。

W0 并行执行 T-01 与 T-02。T-01 是 fail-closed 探针：若真实 hosting 不能证明可信 owner、source/deployment/generation、旧请求 quiescence、request-body/memory limits，则记录证据并停止所有生产维护 route 工作，绝不能改用 caller header、浏览器 shared secret 或时间猜测。按需可创建一个从不绑定生产 D1/R2、始终 owner-only 的临时隔离 Site；不得放宽现有生产 Site audience。

用户已授权自动完成特性 003 的 T-01–T-26，无需逐票等待回复；非降级独立 review 通过后记录 `auto-approved 2026-09-12` 并继续。T-25 只有在所有 attestation、CI、restore rehearsal 与 rollback 门通过后才可部署 snapshot-only build；该 build 只能包含 maintenance active 0003，保持 normal mode，不冻结/不 reset。T-26 只能准备 quarantined 0004 promotion/handoff，不能部署。

绝对禁止：部署或执行 reset；自动执行 `001/T-14`；把 active 0004 发到生产；把生产私人 rows、notes、ratings、R2 keys、evidence bodies、credentials 或 confirmation values 写入 Git、日志、终端输出或模型上下文；部署旧 Site version 16；让无 fence 的 version 15 在维护期恢复为 writer；修改已部署 migration；绕过测试、独立评审或 attestation 以强行完成任务。

如果一项硬门失败，失败关闭并留下清楚的 blocker、证据类别和安全的下一步，不要降低规格。若全部 T-01–T-26 完成，运行完整独立代码门，更新 `progress.md`，用 CLI commit/push 当前分支并创建 PR；不要自行合并 `main`。最终汇报已完成票、测试/CI、隔离/生产部署事实、剩余的 `001/T-14` 人工维护门，以及任何临时 Site/资源，但不得泄露私人 evidence。
