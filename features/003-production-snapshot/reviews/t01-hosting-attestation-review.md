# T-01 托管证明硬门探针代码评审（第 1 轮）

- 日期: 2026-09-12
- 评审方式: subagent
- 固定点: `beea843`
- 审查对象: `reviews/t01-hosting-attestation-probe.md`（fail-closed blocker record；不是功能实现）
- 结论: 通过 — blocker record 可接受，且 T-01 必须保持未完成
- auto-approved 2026-09-12

## 审查证据

- 独立冷读 `handoff.md`、`CONTEXT.md`、产品架构/假设、决策、维护手册，以及本特性的任务票、规格、架构和进度。
- 独立检查 `git log`、`git diff beea843...HEAD`、暂存差异和未跟踪清单：`HEAD` 仍为 `beea843`，没有已提交或暂存的生产、部署、migration/reset 或凭证处理变更。工作树中 T-01 的对象仅为 blocker record；其余未跟踪 migration-packaging 文件属于并行 T-02，未纳入本评审。
- 独立读取非敏感 hosting manifest：只声明逻辑 D1/R2 binding 名称，未提供可验证的 owner allowlist、server-derived source/deployment/generation、activation/quiescence，或绑定 generation 的 request-body/memory limits。未调用任何外部/部署命令，未读取 D1/R2 内容或凭证。
- 本票因硬门未能取得可信 hosting inputs 而没有可运行实现或行为测试；这与 T-01 的 fail-closed 结果一致。未以本地 mock、caller header 或时间猜测替代真实托管验收。

## Standards

没有严重或一般问题。

- `features/003-production-snapshot/reviews/t01-hosting-attestation-probe.md`: 记录只包含安全的能力类别、缺失事实和解除条件；未引入运行时代码、部署脚本、秘密、私人 evidence 或生产数据。因此不适用代码异味基线中的命名、重复、数据泥团、条件分支或过度抽象检查。
- `git diff beea843...HEAD` 与暂存区为空；审查对象不改变 hosting audience、D1/R2 binding、migration 或 reset 路径。T-01 记录明确拒绝创建/deploy 临时 Site，故不存在外部状态变更可复验。

## Spec

没有严重或一般问题。

- `tickets.md` 的 T-01 要求可信 owner、source/deployment/generation、原子 generation activation、旧请求 drain，以及 request-body/memory limit；blocker record 对每项分别列出未获证明的原因，并使票保持未勾选。
- `spec.md` AC-4/AC-7 和 `architecture.md` 的横切偏离要求可信 hosting context、伪造 identity 拒绝、generation/quiescence 与经证明的分块边界；记录没有用 caller-supplied header、浏览器 shared secret、构建时常量、上传样本或时间猜测填补缺口。
- `handoff.md`、`docs/maintenance.md` 与 AC-8 禁止在硬门未通过时推进维护入口、生产 deploy 或 reset；记录的停止范围和四项解除条件与这些约束一致。

## 结论说明

本结论只批准 T-01 的失败关闭 blocker record，不表示 T-01 已完成、也不解锁 T-03、T-05、T-11 或 T-18。只有在 owner-only disposable Site 上获得并独立验收记录所列四类受信 hosting inputs 后，才可按 TDD seam 重新执行 T-01。
