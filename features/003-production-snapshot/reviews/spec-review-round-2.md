# 003 生产快照规格评审（第 2 轮）

- 日期: 2026-09-12
- 评审方式: subagent
- 结论: 需修改

## 第 1 轮关闭情况

- migration 重排已由 A-12 明确确认，AC-1 约束了 pending 字节、checksum、snapshot-only 与 reset-stage 包成员关系。
- AC-2 已把 mutation fence、在途 lease 排空、write revision 与 R2 跨阶段写入纳入系统级契约。
- AC-6 已提供受固定 schema 约束、可恢复全部 D1 schema/data 的封闭路径及非白名单故障注入演练。
- AC-3/AC-4 已量化 evidence bounds 与 5 分钟 confirmation；AC-4/AC-7 已覆盖受信 owner 身份和真实 preview；AC-3/AC-5/AC-7 已要求服务端构建／部署身份。

## 发现项

- [严重] `AC-4 Owner-only maintenance protocol` 第 5 项与 `Solution`、`AC-3`、`AC-5`: AC-4 禁止任何 response 包含 D1 values 或 R2 keys，但本地 CLI 必须通过 maintenance route 分页取得这些值才能生成完整 evidence；按当前文字，实现要么违反 AC-4，要么无法产出快照。→ 明确区分“受 owner 认证且专用于下载的 snapshot page payload”和普通控制响应／错误／日志；只允许前者承载私密 evidence，要求端到端 `no-store`、固定 content type、禁止中间缓存与响应体日志，且 CLI 直接写受限文件、不把 payload 输出到终端或模型工具结果。其余响应继续执行当前脱敏白名单。

- [一般] `AC-2`、`AC-3 Complete, bounded evidence protocol v1`: write revision 只能证明经过应用 wrapper 的 mutation 未发生，单次分页 R2 list 仍可能在对象被控制台、旧凭证或其他带外路径增删时生成撕裂 inventory；当前“count disagreement”没有定义比较对象，也未恢复第 1 轮所要求的第二次终态 inventory。→ 在 fence/lease/revision 检查之外，对 R2 至少执行两次从头到尾的独立 inventory，并要求排序后的 key、bytes、ETag/provider timestamp、页终止证据及整体 digest 完全相同；不一致即 capture 失败。真实 preview 增加两轮之间带外变更的失败用例，或给出供应商能够提供同等 point-in-time 一致性的可验证契约。

- [建议] `AC-1` 与现有 `docs/decisions.md`、`docs/maintenance.md`: A-12 已确认且规格明确声明 one-time exception，但稳定决策登记册和维护手册仍把原 active 0003 描述为不可移动且继续以其旧路径指导 T-14。→ 在本特性进入实现前，把“未部署 migration 的一次性重排不等同于修改已部署 migration”登记为 Accepted，并同步维护手册中的 0003/0004 名称、checksum 门和执行顺序，避免运维人员按旧手册误发布 reset。

## 范围与可测试性结论

- 完整 D1 restore、持久 fence 和真实 preview 的工作量较大，但它们直接来源于用户确认的不降低备份／回退门，不判定为过度设计。
- 除上述 response 契约冲突和 R2 分页一致性缺口外，失败路径、范围外事项、量化边界及测试缝已足以由第三方判断通过／失败。
