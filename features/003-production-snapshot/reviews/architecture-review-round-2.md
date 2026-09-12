# 003 生产快照与 T-14 解锁架构评审（第 2 轮）

- 日期：2026-09-12
- 评审方式：独立 subagent
- 结论：通过

## 复核证据

- 本轮仅对照第 1 轮四项 finding、已确认 `spec.md`、`product/architecture.md` 与 D-020 冷读修订后的 `architecture.md`，并核对修订是否引入新矛盾；未修改被评对象或实现。
- 正文 58 行，保持一页增量架构；MaintenanceApplication 仍与 20 个产品 operation catalog 分离，产品对齐、私密 evidence 分流、D1/R2 ports 与无 UI/Agent 扩张均保持成立。

## 发现项

- 无。

## 首轮发现关闭情况

1. `architecture.md:15-20,30,45`：已关闭。`MutationLease` 提供固定的 external-write/D1-commit checkpoints，封闭 `MutationSettlement` 区分 `no_write | d1_committed | compensated | unresolved`；现有 D1-only、media attach 与 media delete 三种真实路径均能表达，coordinator 可据实际 settlement 增加 revision、结算或保留 lease。冻结映射为既有安全 `dependency_failure`，不扩张 operation catalog 或输入输出。
2. `architecture.md:39-41,47`：已关闭。before capture 强制 confirmations/restore-runs 为空，restore ID 由 maintenance/before/target digests 稳定派生；非控制对象分阶段持久化进度，控制表只在最终单个 D1 atomic batch 中恢复。final batch 失败则 run 仍在，成功则全 D1 已回到 frozen/empty before 状态且旧 token 消失，逐表 digest、重入依据和重放失败条件形成闭合状态机。
3. `architecture.md:46-47,53-54`：已关闭。初次切换要求 attestor 证明 generation 原子激活、托管最大请求期及旧 generation quiescence；回滚明确使用仍含同一 coordinator/fence 的 snapshot-only compatibility artifact，禁止 version 15 直接恢复为对外 writer，因此失败期间冻结不会被旧 writer 绕过。
4. `architecture.md:25-35,46,53-54`：已关闭。`DeploymentAttestor` 统一拥有 snapshot-only/reset migration manifest、pending↔0004 字节/checksum、version 16 denylist、source/deployment/generation、owner 与 quiescence attestation；caller headers 明确不可信。隔离 preview 是实现第一票的硬门，任何真实托管事实不可取得即停止 production route 实现，符合 AC-1/AC-7 的失败关闭要求。

## 检查清单结论

- 产品对齐：符合模块化单体、Ports & Adapters、Application Operations 唯一产品入口及 D-020；owner-only MaintenanceApplication 例外被限制在 maintenance trust zone。
- 规格覆盖：mutation fence、双 R2 inventory、完整 bounded evidence、owner/CSRF/no-store、CLI 私密落盘、full-D1 restore、自覆盖/重放/中断、preview attestation、compatibility rollback 与 T-14 保持冻结均有明确落点。
- 决策质量：MutationCoordinator、MaintenanceApplication 与 DeploymentAttestor 的 interface 均以少量方法隐藏高复杂度流程，内部 ports 有生产 adapter 与 fake/preview adapter 的真实替换理由；未见为范围外未来能力预建的浅接缝。
- 可实现性：关键流程已能拆为 preview attestation、fenced mutation、capture/evidence、restore 状态机与 compatibility rollback 的垂直票；失败模式均有可判定的停止或恢复路径，未发现新的严重／一般问题。
