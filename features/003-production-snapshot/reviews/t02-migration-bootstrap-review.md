# T-02 Migration bootstrap 安全切片代码评审（第 1 轮）

- 日期: 2026-09-12
- 评审方式: subagent
- 固定点: `beea843`
- 审查对象: T-02 的 migration、manifest/checker、CI/package 与受影响维护工具引用
- 结论: 需修改

## 审查证据

- 独立冷读 `handoff.md`、`CONTEXT.md`、产品架构/假设、决策、维护手册，以及本特性的 `feature.md`、`spec.md`、`architecture.md`、`tickets.md`、`progress.md` 和最终通过的上游评审。
- 独立检查 `git diff beea843...HEAD`、工作树未提交差异和全部 T-02 migration/CI/package/checker 文件；未执行任何 reset、migration apply、部署或外部命令，也未读取 D1/R2 或私人 evidence。
- 本人验证 pending artifact 的 SHA-256 为 `c79819304252399ae9d4e5c74c46bca33f3c0b259655173749b812e4e4ad8e16`，与 `beea843:apps/web/drizzle/0003_reset_test_place_assessments.sql` 的 SHA-256 和 Git blob ID `47f27cc14969fd67bb642660494465257df53f21` 一致；字节 diff 为空。active `0003_maintenance_controls.sql` 不包含 `place_assessments` 或 reset SQL。
- 本人运行：`npm run migration:check`（通过）；`node --experimental-strip-types --test scripts/migration-packaging.test.mjs`（2/2 通过）；受影响的 maintenance suites（17 项中 6 项失败，见 Standards）。`git diff --check` 无空白错误。`format:check`、lint、typecheck 不能运行，因为该工作树没有 `node_modules`，`oxfmt`、`oxlint` 和 `tsc` 均不可用；这不是通过替代。

## Standards

- [一般] `apps/web/lib/maintenance/assessment-reset.ts:111-117`: T-02 删除 active `0003_reset_test_place_assessments.sql`，但本地安全演练工具仍读取该已删除路径，导致六个现有 maintenance tests 以 `ENOENT` 失败，包括 immutable-reset、evidence 与 rehearsal 路径。→ 把受控本地工具/测试显式改为读取 non-runnable pending artifact（不把它放回 active migration stream），并恢复全部受影响测试的通过状态。
- [一般] `docs/maintenance.md:26`、`CONTEXT.md:88`: 作为 handoff 明确要求读取的权威维护指导仍把 reset 描述为 active `0003` 路径，已与实际 pending `0004` artifact 矛盾，且维护手册链接已失效。→ 在同一安全切片更新状态与链接为 pending reset → active maintenance 0003 → future active reset 0004，保留“不执行/不部署 reset”的边界。

## Spec

- [一般] `apps/web/scripts/migration-packaging.ts:39-54`: `reset-stage` 在校验 active `0004` 字节前，无条件以 snapshot-only 四文件名单调用 `assertExactMembership`；因此正确加入 required active `0004` 时也必定失败，无法实现/证明 AC-1 所需的 reset-stage package。当前测试只证明“0004 缺失时失败”，没有覆盖 exact `0004` 成功或 byte mismatch/extra migration 拒绝。→ 为两个 stage 定义各自的精确 active membership；reset stage 必须仅在 snapshot baseline + 精确 `0004`、无额外改变 reset 语义的 migration 时通过，并以成功与负向行为测试固定它。
- [一般] `apps/web/scripts/migration-packaging.ts:51,63-69,134-140`、`.github/workflows/ci.yml:45-47`: CI 当前只断言 manifest 的数组包含数字 16；`migration:check` 从未对任一 release/deployment candidate 调用 `assertSiteVersionIsDeployable`，也没有针对 version 16 的拒绝测试。因此它不能满足 T-02/AC-1 的 Site version 16 denylist 必须由 CI 强制拒绝。→ 把候选 Site version 纳入受 CI 调用的 packaging/attestation input，拒绝 16，并添加 version-16 negative test；不要用仅检查 manifest 常量存在来代替部署候选门。

## 结论说明

pending reset 的原始字节、SHA-256 与 Git blob 均得到独立确认，snapshot-only membership check 也通过；但维护演练已回归、reset-stage 永远不可成为有效 package，且 version 16 仅被声明而未由 CI 对候选物强制拒绝。存在一般 finding，T-02 不可勾选、不可 auto-approved，且不解锁依赖 T-02 的票。修复后须由未参与修复的独立 reviewer 重跑 Standards + Spec 双轴代码门。
