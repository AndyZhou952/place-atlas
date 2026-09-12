# 架构 — 003 生产快照与 T-14 解锁

- 日期：2026-09-12
- 对应规格：[`spec.md`](spec.md)
- 状态：已确认
- 用户确认：2026-09-12

## 对齐产品架构

本片落实 [`product/architecture.md`](../../product/architecture.md) 的 Application Operations 写入可靠性与运维适应度，触及 Application Operations、Personal Memory、Atlas Catalog、Acquisition 及其 D1/R2 adapters；不改变领域规则、Web MVVM 或 20 个产品 operation。维护能力是独立的基础设施 module，不进入 Conversation Coordination、Agent/WebMCP catalog 或普通 UI。一次性 migration 重排遵循 [`D-020`](../../docs/decisions.md)。

## 本片模块与缝

```ts
interface MutationCoordinator {
  run<T>(intent: MutationIntent, work: (lease: MutationLease) => Promise<MutationSettlement<T>>): Promise<Result<T>>;
}
interface MutationLease {
  checkpoint(stage: 'before_external_write' | 'after_external_write' | 'before_d1_commit'): Promise<GateDecision>;
}
interface MaintenanceApplication {
  execute(command: MaintenanceCommand): Promise<MaintenanceResult>;
  readEvidencePage(query: EvidencePageQuery): Promise<EvidencePage>;
  stageRestoreChunk(chunk: RestoreChunk): Promise<StageReceipt>;
}
interface DeploymentAttestor {
  attest(stage: 'preview' | 'snapshot_only' | 'reset'): Promise<Result<DeploymentAttestation>>;
}
```

- `MutationCoordinator` 是 Product Core 内的 deep module。`AtlasApplication` 依据 descriptor `effect` 只把 `write | destructive` handler 交给 `run`；`MutationLease` 为跨 D1/R2 handler 提供固定 checkpoints，封闭 `MutationSettlement` 区分 `no_write | d1_committed | compensated | unresolved`，使 coordinator 正确增加 revision 或保留 unresolved lease。冻结在内部映射为既有 `dependency_failure` 安全结果，不增加 operation key/input/output。
- `MaintenanceApplication` 是独立 deep module，封装 freeze/drain、capture session、双 R2 inventory、confirmation、restore 与 digest 验证；三个 interface 方法分别承载小型控制结果、私密出站 evidence 和有界入站 restore chunks。它不复用或扩展产品 operation catalog。
- `DeploymentAttestor` 是发布门的 deep module：只从 CI migration manifest、服务端嵌入的 source/deployment/generation、托管身份上下文与托管请求生命周期读取证明；caller headers 不可信。它验证 snapshot-only 不含 reset、pending↔0004 字节/checksum、version 16 denylist、owner 身份、active generation 与旧请求 quiescence，失败即阻止 preview/production 命令。
- 内部 seams 为 `MaintenanceStatePort`、`D1SnapshotPort`、`R2InventoryPort` 与上述 attestation sources；生产 adapters 使用 D1/R2/hosting，本地 fakes 与隔离 preview adapters 运行同一 contracts。canonicalization/expected-schema registry 保持 module 内部 implementation。
- `MaintenanceHttpAdapter` 只做可信 owner/Origin/CSRF/no-store 映射；`SnapshotCliAdapter` 顺序消费 evidence page、直接原子写 owner-only 文件并离线复验，正文不进入 stdout。两者都不依赖 React 或模型。
- 依赖只允许：`product inbound adapters → AtlasApplication → MutationCoordinator → MaintenanceStatePort ← D1`；`Maintenance HTTP → MaintenanceApplication → snapshot/inventory/control ports ← D1/R2/hosting`；`MaintenanceApplication → DeploymentAttestor`；CLI 只依赖 maintenance HTTP interface。两个 application modules 不互调。

## 核心数据

- active 0003 新增 `maintenance_control` singleton（mode、maintenance ID、writer generation、write revision）、`maintenance_write_leases`（lease/operation/owner/start/expiry/resolution）、`maintenance_confirmations`（owner/action/evidence/target digest/expiry/consumed）、`maintenance_restore_runs`（operation、phase、target digest）与 `maintenance_restore_chunks`（operation/index/bytes/digest/sealed）。
- `EvidenceEnvelopeV1` 保存服务端 build/deployment identity、冻结前后 revision、全部允许 schema objects/rows、两轮独立 R2 inventory、页终止证据、bounds、counts 与 section/overall digests；closed internal-object exclusions 和 expected schema registry 均版本化并随构建发布。
- before capture 要求 leases/confirmations/restore-runs/chunks 为空。restore ID 由 maintenance/before/target digests 稳定派生；confirmation 同时绑定这三者。CLI 按 attested request limit 将完整 envelope 切成编号 chunks；exact duplicate 幂等、冲突 duplicate 失败。所有 chunks/count/digest/sealed envelope 验证通过前不允许业务 mutation。
- 业务与 schema 分阶段幂等恢复时 control/chunk 表保持当前 run；最后一个 D1 atomic batch 才把全部控制表恢复为 before 的 frozen/empty 内容。此前中断按 restore-run + 已封存 chunks + 逐表 digest 续跑；final batch 中断要么完整回滚而 run 仍在，要么完整提交且全 D1 已等于 before。提交后旧 token/chunk/run 行消失且 target digest 已改变，重放失败；紧接 final batch 的只读全库 digest 是完成判据，响应丢失时以“全库等于 before 且无 run”识别已完成。

## 关键流程

1. **普通 mutation**：coordinator 登记 lease → D1-only handler 返回 `d1_committed`；media attach 在 put 前/后与 D1 commit 前 checkpoint，冻结则补偿并返回 `compensated`，补偿未知返回 `unresolved`；media delete 的 D1 已提交但 R2 失败仍返回 `d1_committed`＋既有 dependency result。coordinator 据 settlement 增 revision/结算或保留 lease。
2. **冻结与 capture**：attestor 验证并切换无 reset 的 snapshot-only generation → 按托管最大请求期证明旧 generation quiescent → 原子 freeze → drain leases → 固定 schema/D1 pages → 完整 R2 list A/B → 复验 fence/revision → CLI 验证并落盘；不一致或越界只产生 incomplete 结果。
3. **恢复与放行**：owner 用 start confirmation 建立稳定 restore run → CLI 分块 stage，服务端 seal 时重组并验证全部 page/section/overall digest 与 expected schema → 分阶段恢复非控制对象并逐段记进度 → final confirmation 后以单个 batch 恢复控制表 → 立即只读复验全 D1 digest/R2 manifest。失败时只回滚到仍含相同 coordinator/fence 的 snapshot-only compatibility artifact；smoke 与新确认通过后才 unfreeze，绝不把无 fence 的 version 15 直接恢复为对外 writer。

## 横切偏离

- 维护 HTTP interface 是产品架构中“入口只能调用 AtlasApplication”的显式例外，但仅存在于 owner-only maintenance trust zone；架构适应度必须反向证明它不能被普通 route、capabilities、WebMCP 或 Agent import。
- 私密 snapshot page 是日志脱敏规则的窄例外：body 可承载 evidence，但 response logger 禁用且端到端 no-store；所有控制/错误结果仍只含安全元数据。
- 实现第一票必须在隔离 preview 证明 attestor 能从可信托管上下文取得 owner、deployment/source/generation、原子 generation 激活、最大请求期与 request-body/memory limit，并注入旧 generation 在途写验证 drain；任一事实不可取得即停止 production route 实现，不降级为时间猜测、caller header、浏览器 shared secret 或未经验证的整包上传。
- rollback artifact 是 snapshot-only compatibility build，不是 version 15；其 manifest、server identity 与 fence contracts 由 attestor 复验后才可接流量。

## ADR 链接

沿用 [`D-002、D-004、D-008、D-016、D-018、D-020`](../../docs/decisions.md)；本片无新增产品级不可逆决策。
