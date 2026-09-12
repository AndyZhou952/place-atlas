# 003 生产快照与 T-14 解锁架构评审（独立新审）

- 日期: 2026-09-12
- 评审方式: subagent
- 结论: 需修改

## 评审证据

- 冷读 `features/003-production-snapshot/architecture.md`、已确认 `spec.md`、`product/architecture.md`、`CONTEXT.md` 与 `docs/decisions.md` 的 D-020。
- 对照当前 `AtlasApplication` dispatcher、20 个 operation descriptors、`media.attach`／`media.delete`／destructive handlers、D1 schema/migrations、server composition，以及当前 Sites hosting metadata 与 `@openai/sites-vite-plugin` 本地说明和实现。
- 正文 50 行，符合一页架构篇幅；独立 `MaintenanceApplication`、控制结果与私密 evidence page 分流、schema/canonicalization 留在 module 内、双 R2 inventory、closed exclusions 和 preview fail-closed 均是合理方向。

## 发现项

- [严重] `features/003-production-snapshot/architecture.md:15-24,38`：`MutationCoordinator.run(intent, work): Result<T>` 只观察最终业务 `Result`，而当前 handler 会在内部吞掉依赖异常并把不同写入事实折叠成同一个 `dependency_failure`。例如 `media.delete` 先提交 D1、再删 R2，R2 失败时 D1 已变；`media.attach` 则会先 put R2、失败时尝试补偿、最后才提交 D1。外层 coordinator 因而无法判断应否增加 revision、lease 应 resolved 还是 unresolved，也没有明确能力在 R2 upload 前、upload 后及 D1 commit 前验证同一 fence。当前闭合 `Result` 也没有 maintenance kind，却声称不改变 20 个 operation contract，未解释 AC-2 的 typed frozen result 如何出现。→ 把内部执行协议补成 lease-aware checkpoint/settlement：由 lease capability 明确提供 fence checkpoint/commit，handler 或 lease-bound write port 返回封闭 settlement（至少 no-write、D1 committed、compensated、unresolved），并画出 D1-only、attach、delete 三条时序以及 frozen result 的对外映射。

- [严重] `features/003-production-snapshot/architecture.md:18-27,33,40`：完整 before envelope 只存在 owner 本地且最多 64 MiB；现有 interface 只有出站 `readEvidencePage` 和泛化 `execute`，恢复流程写的是提交 before digest 与 confirmation，没有任何把 schema/rows 安全送回服务端的 restore data plane。digest 不能重建行，正文也没有说明单请求 envelope 是否满足真实 hosting 的 body/memory 上限、如何在 mutation 前完成整包验证，或分页上传怎样绑定 operation、去重并在中断后恢复。因此 AC-6 的“接受已验证 envelope 并恢复全部对象/行”没有可实现落点。→ 定义有界的 restore ingress（整包时先取得并验证真实平台上限；否则使用 begin/stage/seal 的分页协议），规定可信暂存位置、page/section/overall digest、operation binding、重复页语义、seal 后才允许 mutation，以及中断清理/续传；该暂存不能被正在恢复的目标状态抹掉。

- [严重] `features/003-production-snapshot/architecture.md:32-34,40`：before evidence 按规格包含 `maintenance_control`、leases、confirmations 和 restore-runs，但当前 restore journal、operation ID、phase、已消费 confirmation 与 target digest 又存放在这些同一批待覆盖表。恢复控制表会删除或倒退本次 run 的持久状态；若在覆盖中途崩溃，“逐表 digest 推导续点”不足以证明这是同一授权 operation，也无法原子区分未执行、执行中与已完成。`target digest 已变化所以旧确认不能重放` 也不成立：重试同一 before evidence 时 target digest 是稳定值，恢复出的旧未消费 confirmation 仍可能重新获得权限；而最终 confirmation 的创建/消费本身又会让“全 D1 等于 before digest”失真。→ 选择一个不被目标恢复覆盖的最小可信 control journal，或给出等价且可证明的 self-restore 状态机；明确稳定 operation identity、两次 confirmation 的生命周期、控制表最后替换点、每个崩溃点的重入判据，以及最终 digest 在何时计算。加入 before 中原有未消费 confirmation 与控制表阶段中断的 fixture，证明权限不会复活且最终全库 digest 精确相等。

- [严重] `features/003-production-snapshot/architecture.md:38-40,46`：首次 snapshot-only generation 之前的旧 Site version 没有 `MutationCoordinator`，不会登记 lease、增加 revision 或服从新 D1 fence；失败时恢复的“旧 writer/旧版本”同样会绕过 fence。当前 server composition 也证实所有 handler 直接装配 D1/R2 adapters。仅等待一个假定的托管请求上限并“验证无旧写入”无法观测旧 generation 的静默写入，更不能保证回滚后仍冻结。→ 明确 generation cutover/rollback contract：优先产出一个已接入同一 coordinator/fence、但保留旧业务行为的 rollback artifact；否则必须由托管层提供可验证的全局流量冻结、generation identity、旧请求终止证明及最大请求期保证。preview 必须注入旧 generation 在途 mutation，证明 freeze/capture/restore 期间无法提交；不满足时不得部署 production maintenance surface。

- [一般] `features/003-production-snapshot/architecture.md:25-28,33,39,46-50`：`BuildIdentityPort`、`TrustedOwnerPort` 与 D-020 引用仍不足以承接 AC-1/AC-4/AC-7 的发布证明。当前 `.openai/hosting.json` 只有 project ID 和 D1/R2 binding；当前 Sites plugin 说明/实现只证明打包 migration metadata 和开发态模拟用户，没有给出生产 owner 身份的可信来源、source/deployment/generation identity、旧请求 drain 或最大请求期契约。架构也未指定谁校验 snapshot-only artifact 排除 reset、active 0003 成员、pending↔0004 字节/checksum、version 16 禁止部署及 source/archive/CI/server 一致性。→ 在 `MaintenanceApplication` 内明确一个封闭 hosting/release attestation contract（或单独的小 port），列出每项可信来源、拒绝 caller headers 的边界、artifact manifest/checksum 与 quiescence 证明；把真实 preview 探针设为任何 production route 实现之前的先决票，探针失败即停止。

## 检查清单结论

- 产品对齐：模块落点、依赖方向和维护入口例外均有声明，未复述产品架构全文。
- 需求覆盖：capture、隐私、双 R2 inventory、closed schema 与维护能力隔离有落点；AC-1、AC-2、AC-6、AC-7/8 仍被上述接口与托管契约阻断。
- 决策质量：`MaintenanceApplication` 是合理 deep module，canonicalization/schema registry 未为第二实现过早开缝；`MutationCoordinator` 的小接口目前以丢失必要写入事实为代价，尚未形成可用 deep interface。
- 可实现性：证据生成与 CLI 可先拆垂直票，但 mutation settlement、restore ingress、self-restore journal 和 generation cutover 尚不能安全拆票；hosting probe 必须前置。
- 过度设计：完整 D1、持久 fence、双 confirmation 和真实 preview 都直接来自已确认规格，不属于过度设计；未发现应为缩小范围而删除的主要能力。
