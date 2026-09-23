# 003 生产快照与 T-14 解锁架构评审（第 1 轮）

- 日期：2026-09-12
- 评审方式：独立 subagent
- 结论：需修改

## 评审证据

- 已冷读确认后的 `spec.md`、`product/architecture.md`、`CONTEXT.md`、D-020、规格第 3 轮通过记录，以及当前 `AtlasApplication`、20 个 operation descriptors、D1 state adapters、R2 media adapter 和既有本地维护工具接缝。
- 设计正文 50 行，符合一页架构篇幅；MaintenanceApplication 与产品 operation catalog 分离、私密 evidence page 与控制结果分流、封闭 schema registry、双 R2 inventory、preview fail-closed 和 D-020 migration 重排方向均与产品架构及规格一致。
- 但三个关键恢复／并发接口尚不能从当前实现安全落地，且 migration/hosting 门缺少可拆票的明确 contract，因此本轮不能通过。

## 发现项

- [严重] `features/003-production-snapshot/architecture.md:15-24,38`：`MutationCoordinator.run(intent, work): Result<T>` 的 interface 只看到最终业务 `Result`，无法区分“未写入即失败”“D1 已提交但 R2 删除失败”“R2 put 后已补偿”“补偿未知”这些当前真实 outcome；例如 `media.delete` 会先提交 D1 再因 R2 失败返回 `dependency_failure`，而 `media.attach` 必须在 upload 前、upload 后、D1 commit 前检查同一 lease。外层 wrapper 既无法在 handler 内插入三处 checkpoint，也无法据普通 `Result` 正确决定 revision 增量、lease resolved/unresolved，因而不能满足 AC-2 的每次已提交 mutation 加 revision、R2 fence 与未知结果可见性。→ 把跨 mutation 的内部 interface 明确为 lease-aware execution：由 coordinator 提供可验证 checkpoint/commit capability，并让 handler 或 lease-bound write ports 返回封闭的 settlement（至少区分 no-write、D1 committed、compensated、unresolved）；说明 frozen 的 typed result 如何在不扩张 20 个 operation contract 的前提下映射。用现有 media attach/delete 与 D1-only mutation 画出完整时序。

- [严重] `features/003-production-snapshot/architecture.md:32-34,40`：恢复把 `maintenance_control`、`maintenance_write_leases`、`maintenance_confirmations`、`maintenance_restore_runs` 也恢复为 before 内容，却把当前 operation ID、phase、已消费 confirmation 和 target digest 持久化在这些同表中；一旦控制表阶段覆盖自身或中途失败，当前 run 的持久进度会消失。正文所称“由逐表 digest 推导续点并要求新确认”没有说明如何重新绑定同一 restore operation/evidence、如何原子跨过 self-restore、何时验证完整 before digest，以及恢复出来的旧 confirmation 为何不能被重放，尚不足以兑现 AC-6 的持久 operation ID、幂等 resume、双 confirmation 与全 D1 精确恢复。→ 选择并写清一个可证明的 self-restore 协议：例如将最小 restore journal 放入不被目标恢复覆盖的独立可信控制存储，或定义控制表最后一次原子替换、稳定派生 operation ID、post-restore 状态判定及新 confirmation 的完整状态机；逐个中断点说明重入依据和最终 digest 时点，并以恢复前已存在 confirmation 的 fixture 验证不复活权限。

- [严重] `features/003-production-snapshot/architecture.md:39-40,46`：失败路径计划恢复“旧 writer/旧版本”后再 smoke，但当前生产旧版本未接入 `MutationCoordinator`，会完全忽略新 D1 fence；一旦它重新接收请求，“失败保持冻结”和 restore digest 都可能被旧写入破坏。初次切换同样只写“等待旧 generation 超过托管请求上限并验证无旧写入”，却没有能观察或阻断旧 generation 的 hosting seam，旧 writer 也不会登记 lease/revision。→ 明确可执行的 generation 切换与回滚策略：优先保留一个带相同 fence/coordinator 的 rollback artifact，仅回退业务实现；否则必须由托管层提供可验证的全局流量冻结、generation identity、旧请求终止证明和最大请求期 contract，并在 preview 注入旧 generation 在途写验证其确实被排空。旧版本不得在仅靠 D1 fence 时重新对外服务。

- [一般] `features/003-production-snapshot/architecture.md:25-28,33,39,46-50`：AC-1/AC-7 的关键发布门只有 D-020 引用、`BuildIdentityPort`／`TrustedOwnerPort` 名称和“无法证明则停止”，没有说明由哪个 module/interface 对 snapshot-only artifact 成员、pending↔0004 字节/checksum、version 16 永不部署、source/archive/server identity 一致性负责；实际仓库的 Sites metadata 只给 project/binding，当前本地 hosting package 只描述开发态模拟用户，未提供这里假定的生产 owner role、部署 generation 或请求排空 contract。此状态不足以拆成可独立验收的垂直票。→ 在架构中补一个小而封闭的 deployment/hosting attestation interface（或明确归入 MaintenanceApplication 内部），列出可信来源、不可接受的 caller headers、owner 判定、deployment/source/generation、旧请求 quiescence 与 migration artifact manifest/checksum；把真实 preview 探针设为实现前门，失败即停止而不是继续实现 production route。

## 检查清单结论

- 产品对齐：方向对齐，维护入口例外有显式说明。
- 规格覆盖：evidence、auth、R2 双枚举和范围护栏有落点；AC-1、AC-2、AC-6、AC-7/8 的上述关键 contract 尚不完整。
- 决策质量：两个 application modules 的外部 interface 有深化意图，但 MutationCoordinator 的 settlement/checkpoint interface 仍过浅；其余内部 ports 基本有生产与测试 adapter 理由，未见单纯为未来预建的主要抽象。
- 可实现性：当前无法安全拆出跨存储 fence、self-restore 和旧 generation 回滚票；需先关闭上述严重／一般发现。
