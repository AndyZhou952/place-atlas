# T-02 Migration bootstrap 安全切片代码评审（第 2 轮）

- 日期: 2026-09-12
- 评审方式: subagent
- 固定点: `beea843`
- 审查对象: 当前工作树内 T-02 migration、manifest/checker、CI/package、维护工具引用及权威维护文档
- 结论: 需修改

## 审查证据

- 独立冷读 `handoff.md`、`CONTEXT.md`、产品架构/假设、决策、维护手册，以及本特性的 feature/spec/architecture/tickets/progress 和第 1 轮 T-02 review；按第 1 轮的四项 finding 逐项复核当前工作树相对 `beea843` 的差异（本轮 HEAD 本身仍是该固定点，T-02 尚未提交）。
- 未运行 migration、reset、部署、外部服务或会执行 reset SQL 的全量测试。仅运行下列非执行型目标测试：`node --experimental-strip-types --test scripts/migration-packaging.test.mjs scripts/migration-packaging-site-version.test.mjs scripts/migration-packaging-reset-stage.test.mjs scripts/migration-packaging-reset-stage-mismatch.test.mjs lib/maintenance/assessment-reset-migration-source.test.mjs`；6/6 通过。这些测试只检查文件成员、候选版本、fixture 字节和工具的 pending-source 解析，不向 SQLite/D1 应用 reset SQL。
- 独立以字节比较确认 pending reset artifact 与 `beea843` 中原 active reset artifact 相同；只记录校验结果，未输出 SQL 正文。`git diff --check` 无空白错误。

## Standards

- [一般] `docs/maintenance.md:26`、`CONTEXT.md:88`: 第 1 轮的权威文档 finding 仍未修复。二者仍把 reset artifact 说成 active `0003_reset_test_place_assessments.sql`，其中维护手册链接指向已删除文件；当前实现已把该 artifact 放在 non-runnable pending `0004`，并用新的 active `0003_maintenance_controls.sql`。这让 handoff 强制读取的操作指导与实际 migration ordering 矛盾。→ 同一安全切片内将两个权威记录改为已落地状态：pending reset → active maintenance 0003 → 仅在 T-14 门禁后才可 active reset 0004；保留不部署、不执行 reset 的边界并修复链接。

- [建议] `apps/web/scripts/migration-packaging.ts.orig`: 工作树保留了未受执行路径使用的编辑器备份文件。移除它，避免把过期实现作为 future packaging 的误读来源；此项不改变本轮结论。

## Spec

- 无一般或严重 finding。第 1 轮的三个实现/规格 finding 已由当前实现和上述受限测试独立复核为已修复：
  - `apps/web/lib/maintenance/assessment-reset.ts:111-117` 现在只读取 non-runnable pending `0004`；source test 通过，且旧 active path 不存在。
  - `apps/web/scripts/migration-packaging.ts:35-63,101-127` 依据 stage 使用各自的精确 active membership；reset-stage 成功 fixture 与 active-0004 byte-mismatch 拒绝 fixture 均通过，当前 snapshot-only root 则在缺少 active 0004 时保持不可用。
  - `apps/web/scripts/migration-packaging.ts:63-69,155-170`、`apps/web/package.json:17`、`.github/workflows/ci.yml:45-47` 要求 CI packaging check 传入 deploy candidate Site version，并对 retired version 16 抛错；version-16 negative test 通过，CI 也实际调用 `migration:check`。
- active `0003_maintenance_controls.sql` 仅建立维护控制、lease、confirmation 与 restore 控制结构及 singleton 初值，未包含 PlaceAssessment reset；snapshot-only exact membership test 也通过。pending reset 的原始字节保持不变，满足 AC-1 的 artifact identity 要求。

## 结论说明

第 1 轮的三项代码/CI finding 均已修复，并在不执行任何 reset SQL 的目标测试中得到复核；但 handoff 指定的权威维护文档仍与已实现的 migration ordering 冲突。这是一般 finding，因此 T-02 仍不得勾选或 auto-approved，也不得解锁依赖 T-02 的票。修正权威文档后，应由未参与修正者再做独立双轴复核。
