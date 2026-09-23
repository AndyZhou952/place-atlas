# 任务票 — 003 生产快照与 T-14 解锁

- 用户确认：2026-09-12
- 执行模式：auto
- TDD 接缝：`MutationCoordinator`、`MaintenanceApplication`、`DeploymentAttestor` 及其 D1/R2/hosting adapters；真实托管行为由隔离 Site 验收，不以内部实现断言替代。

## 执行清单

- [ ] T-01 托管证明硬门探针 — Blocked by: None — 在隔离 owner-only Site 验证可信 owner、source/deployment/generation、原子 generation 激活、旧请求排空、请求体与内存上限；任一事实不可取得则失败关闭并停止生产维护入口实现。
- [ ] T-02 Migration bootstrap 安全切片 — Blocked by: None — 保持原 reset SQL 字节与 SHA-256 不变并移入 non-runnable pending；新增只含维护控制结构的 active 0003；CI 固定 migration manifest、checksum 与 Site version 16 denylist。
- [ ] T-03 DeploymentAttestor 行走骨架 — Blocked by: T-01, T-02 — 从可信 CI/server/hosting 来源验证 owner、artifact、deployment、generation 与 quiescence；拒绝 caller headers，并让 preview/snapshot/reset 三阶段失败关闭。
- [ ] T-04 Evidence Protocol V1 行走骨架 — Blocked by: T-02 — 固定 envelope、canonicalization、page/cursor、closed exclusion、bounds、counts 与 section/overall digest contracts。
- [ ] T-05 MutationCoordinator 行走骨架 — Blocked by: T-01, T-02 — 以 PlaceAssessment 写入贯穿 lease、checkpoint、`no_write | d1_committed | compensated | unresolved` settlement、revision 与既有 dependency result 映射。
- [ ] T-06 D1-only mutation 接入 — Blocked by: T-05 — 把 Import、Catalog、Assessment、Visit 的纯 D1 写入接入同一 coordinator；无 mutation route/state adapter 可绕过 fence。
- [ ] T-07 Media mutation 接入 — Blocked by: T-05 — 接入 media attach/caption/delete，在 R2 put 前后和 D1 commit 前 checkpoint，锁定补偿、orphan、revision 与 unresolved 行为。
- [ ] T-08 Destructive mutation 接入 — Blocked by: T-05 — 接入 Visit/AtlasItem 级联删除的 D1/R2 时序、best-effort cleanup、revision 与完整故障矩阵。
- [ ] T-09 Mutation 汇合与适应度门 — Blocked by: T-06, T-07, T-08 — 单一 owner 更新 composition；并发、全 catalog 与 AST fitness 证明所有 write/destructive operation 经过 coordinator。
- [ ] T-10 Fence、lease、revision 与 drain 切片 — Blocked by: T-03, T-09 — 实现 persistent freeze、writer generation、lease drain、过期但未决 lease 的显式处理及冻结期间 fail-closed。
- [ ] T-11 Owner maintenance HTTP 与 confirmation — Blocked by: T-03, T-10 — 实现可信 owner、Origin/CSRF、POST/no-store、跨实例 5 分钟单次 confirmation、控制结果和请求/响应日志脱敏。
- [ ] T-12 D1 schema snapshot adapter — Blocked by: T-04, T-10 — 枚举 table/index/trigger/view、版本化 closed internal exclusions，并让未知或变化对象失败关闭。
- [ ] T-13 D1 row snapshot adapter — Blocked by: T-12 — 确定性分页所有表和重复行，覆盖空表、cursor、截断、单行/总量限制与 schema/revision 变化。
- [ ] T-14 R2 stable inventory adapter — Blocked by: T-04, T-10 — 从 bucket 独立完成两轮全分页枚举；逐项、终止证据、counts 和 digest 一致，否则 capture 失败。
- [ ] T-15 Evidence verifier module — Blocked by: T-04 — 用独立已知示例验证 canonical bytes、pages、bounds、schema、sections 与 overall digest；不与生产生成逻辑同义反复。
- [ ] T-16 Capture orchestrator 与 evidence HTTP — Blocked by: T-11, T-13, T-14, T-15 — 编排 maintenance ID、fence/lease/revision 首尾检查、D1/R2 capture、取消/incomplete 与私密分页 response。
- [ ] T-17 Secure capture CLI — Blocked by: T-15, T-16 — 顺序消费 pages、离线复验并以 owner-only 权限原子落盘；拒绝覆盖、symlink/hardlink alias，stdout/model output 不含私密正文。
- [ ] T-18 Restore begin/stage/seal — Blocked by: T-01, T-11, T-15 — 按已证明 body/memory limit 分块，绑定 restore ID，exact duplicate 幂等、冲突 duplicate 失败；seal 完整验证前不允许 D1 restore mutation，stage request body 永不记录。
- [ ] T-19 Restore CLI uploader/resume — Blocked by: T-18 — 从受限 before evidence 分块上传，支持安全续传、重复响应和冲突中止，不把 evidence 输出到终端。
- [ ] T-20 Compiled schema preflight — Blocked by: T-18 — 用构建内 expected schema/显式 per-table adapters 检查全部对象和行；拒绝 evidence SQL、自由表列名、未知对象及不兼容版本。
- [ ] T-21 Non-control phased D1 restore — Blocked by: T-19, T-20 — 幂等恢复非控制 schema/data，逐阶段持久记录并在任一中断点安全续跑；写入保持冻结。
- [ ] T-22 Atomic control self-restore — Blocked by: T-17, T-21 — 用 final confirmation 和单个 D1 batch 恢复控制表；覆盖 token 重放、响应丢失、既有 confirmation 不复活、非白名单故障注入、全 D1 digest 与 R2 manifest equality。
- [ ] T-23 Snapshot-only compatibility archive — Blocked by: T-03, T-09, T-11, T-17, T-22 — 生成含同一 fence/coordinator 的安全回滚 build；attestor 证明不含 reset、identity 一致且 version 15/16 不可作为维护期 writer。
- [ ] T-24 真实隔离环境验收 — Blocked by: T-23 — 在 disposable D1/R2 的 owner-only Site 验证 AC-7 全矩阵，包括伪造身份、跨站、跨实例 token、旧 generation 在途写、两轮 R2 间带外变化、stage body 日志和完整 restore。
- [ ] T-25 Snapshot-only 生产部署 — Blocked by: T-24, independent code review — 在用户 2026-09-12 的 auto 授权下，仅当所有 attestation/CI/rollback 门通过时部署 active 0003 与维护能力；保持 normal mode，不 capture、不 reset，访问策略继续 owner-only。
- [ ] T-26 Reset-stage 隔离交接 — Blocked by: T-25 — 准备自动化但默认不可部署的 0004 promotion path；只有同一维护窗口取得完整生产 before evidence 后才可生成/attest reset-stage artifact，并移交 `001/T-14`。本票及本特性不得部署或执行 reset。

## 并行波次与文件冻结

| 波次 | 可执行票 | 最大实现并发 | 汇合门 |
|---|---|---:|---|
| W0 | T-01、T-02 | 2 | 探针给出 pass/fail 证据；pending/active migration membership 与 checksum CI 通过 |
| W1 | T-03、T-04、T-05 | 3 | 冻结 attestation、evidence protocol、settlement/checkpoint interfaces |
| W2 | T-06、T-07、T-08 | 3 | 并行作者不得修改中央 `atlas-application.ts`、server composition 或 fitness owner；T-09 单一汇合 |
| W3 | T-09 → T-10 → T-11 | 1 | 全 mutation fence 与 owner-only 控制面 contracts 通过 |
| W4 | T-12→T-13、T-14、T-15 | 3 | 各自只修改 D1、R2、verifier 所有权文件；T-16 单一汇合 |
| W5 | T-16→T-17；T-18→T-19 | 2 | capture 与 restore ingress 分别完成后运行隐私/协议交叉测试 |
| W6 | T-20→T-21→T-22 | 1 | 完整 self-restore、故障注入及 before digest 复现通过 |
| W7 | T-23→T-24 | 1 | compatibility artifact 与真实隔离验收均通过独立代码门 |
| W8 | T-25→T-26 | 1 | 只部署 snapshot-only；reset-stage 始终 quarantined，交给 001/T-14 |

- 每票由同一实现 Agent 完成一个测试失败、最小实现、测试通过；不得把测试和实现拆给不同 Agent。
- 并行 Agent 不切换共享工作树分支、不提交、不运行全仓写格式化；主 Agent 负责每波汇合、全量验证、commit 与 push。
- 任何票需要改变已冻结 interface 时，全波停止，回到 interface owner 串行修订并独立复审。
- T-01 或 T-24 的可信托管事实失败时，保持相关票未完成并记录 blocker；禁止以 shared secret、caller header、时间猜测或跳过恢复来换取完成。

## Auto 与生产安全范围

- 用户于 2026-09-12 授权云端 Agent 无需逐票确认，完成独立评审后自动进入下一票；允许按需创建一个不绑定生产 D1/R2、始终 owner-only 的临时隔离 Site。
- T-25 的授权只覆盖经全部门禁证明不含 reset 的 snapshot-only 部署；不得改变 Site audience，不得冻结生产写入，不得 capture 私人正文到 Git/日志/model output。
- 生产 freeze、before capture、active 0004 部署、四字段 reset、writer smoke 与 unfreeze 仍属于 [`001/T-14`](../001-agent-ready-core/tickets.md) 的同一不可中断维护窗口；不得由本特性自动执行。
