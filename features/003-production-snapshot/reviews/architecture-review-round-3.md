# 003 生产快照与 T-14 解锁架构评审（第 3 轮）

- 日期：2026-09-12
- 评审方式：独立 subagent
- 结论：通过
- 用户确认：2026-09-12

## 复核证据

- 本轮冷读修订后的 `architecture.md`，并对照已确认 `spec.md`、`product/architecture.md`、D-020、第 1/2 轮架构评审；范围限于既有四项 finding 与新增 restore ingress，不修改被评对象或实现。
- 正文 60 行，仍是一页增量架构；新增 `stageRestoreChunk` 是私密、有界的数据面，`execute` 继续承载小型控制面，未进入 20 个产品 operation、Agent/WebMCP 或普通 UI。

## 发现项

- [建议] `features/003-production-snapshot/architecture.md:35,54`：restore chunk 的请求正文现在也承载私密 evidence，而日志例外文字只点名 snapshot response body。→ 实现票中把 stage route 的 request-body 不记录／脱敏列为明确 contract，并加入 preview 负面测试；现有产品级“日志只记录结构化标识”和 owner/Origin/CSRF/no-store 门已使其不构成本轮阻断。

## 第 2 轮与 ingress finding 关闭情况

1. `architecture.md:15-20,31,47`：lease checkpoints 与封闭 `MutationSettlement` 保持完整，D1-only、media attach/delete 的 revision、补偿和 unresolved 语义未被 restore data plane 改动。
2. `architecture.md:40-43,49`：before capture 强制 leases、confirmations、restore-runs、chunks 全空；非控制对象恢复期间保留 run/chunks，最后单个 D1 atomic batch 才恢复全部控制表。batch 失败时 run 仍可续传，成功时控制状态与 chunk 行同时回到 before，随后全库只读 digest 可证明完整 before，而非只证明业务表。
3. `architecture.md:42-43,49`：start confirmation 先原子消费并建立由 maintenance/before/target digests 稳定派生的 run，之后才允许 stage；exact duplicate 幂等、冲突 duplicate 失败，seal 在任何业务 mutation 前验证完整 chunk 集、counts、section/overall digest、schema 与 envelope。final confirmation 仍单次消费；成功后 token/run/chunks 消失且 target 已变化，重放失败，响应丢失可由“全库等于 before 且无 run”判定完成。
4. `architecture.md:32,40-42,49,55`：D1 staged chunks 补齐了真实入站 data plane，并提供跨 runtime 的中断续传依据。单请求大小由 attested request limit 切块，总 uncompressed envelope 的 counts/bounds/digest 在 seal 前验证，故超过 64 MiB 不会进入恢复 mutation；真实 request-body/memory probe 是 production route 的硬门，失败不会退化为整包上传。
5. `architecture.md:33,48-56`：`DeploymentAttestor`、preview-first gate、snapshot-only compatibility rollback、可信 owner/generation 与旧请求 quiescence 保持闭合；新增入口没有重新引入 caller header、version 15 writer 或无 fence 回滚。

## 检查清单结论

- 产品与规格：MaintenanceApplication 仍是 owner-only 基础设施例外；mutation fence、完整 evidence、full restore、自覆盖、双确认、防重放、64 MiB 上限及失败冻结均有落点，无范围外产品能力。
- 接缝质量：三个方法分别隔离控制、出站 evidence 与入站 chunks，接口增长对应真实协议方向而非未来抽象；D1 staging 隐藏在维护状态 port 后，生产 adapter 与 fake/preview adapter 均有明确替换理由。
- 可实现性：begin/stage/seal、断点续传、final atomic self-restore 与完成判据构成闭合状态机；托管 request/memory 能力未知被放在真实 preview fail-closed 门，而非架构假设。未发现新的严重／一般问题。
