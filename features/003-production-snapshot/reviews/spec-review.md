# 003 生产快照规格评审（第 1 轮）

- 日期: 2026-09-12
- 评审方式: subagent
- 结论: 需修改

## 发现项

- [严重] `Solution`、`Implementation Decisions / Two-stage migration delivery`: `product/assumptions.md` 的 A-12 仍是“待确认”，规格却已把暂存并恢复 0003 写成既定方案；同时没有定义如何在“不修改／不删除已审核 migration”约束下完成暂存，存在静默推翻 migration immutable 决策以及误发布 0003 的风险。→ 先取得用户对 A-12 的明确确认并更新假设／决策状态；规格再定义可判定的封装契约（优先由发布包 allowlist 排除 0003，而不改动已跟踪 migration 文件），并要求 CI 同时证明仓库中的 0003 字节与已审核 checksum 不变、snapshot-only 包不含 0003、reset-stage 包只恢复同一文件。

- [严重] `Solution`、`Evidence model`、`T-14 gate integration`: “用户停止写入”不是系统级一致性边界；D1 表和 R2 inventory 的多页读取期间，现有 Web、WebMCP、旧在途请求或后台写入仍可能产生一个从未真实存在过的混合快照，双次 inventory 也不能排除等量写入。→ 将全入口 mutation fail-closed、排空在途请求和捕获期间持续验证写入 fence 写成验收标准；只有同一 maintenance ID 下 fence 生效且首尾 revision／写入计数未变化时证据才可标记 complete，任一入口绕过或并发 mutation 都必须使 capture 失败。

- [严重] `Recovery`、`Out of Scope` 与 `docs/maintenance.md §8`: 规格只提供四字段恢复，并明确排除 whole-database mutation；若 after evidence 发现 migration／部署意外修改了白名单外 D1 schema 或数据，四字段恢复无法把生产恢复到 before 状态，却仍声称可“恢复旧代码和四字段值”。这不满足用户已确认的不降低完整备份／回退门，也与维护手册要求“恢复维护前的完整 D1 snapshot”冲突。→ 在进入架构前明确一条经过演练、能从该 evidence 恢复全部已捕获 D1 schema/data 的生产恢复路径（或已验证的供应商级完整恢复能力）；白名单 recovery 可以作为快速路径，但不能冒充完整回退。加入故障注入验收：制造一项非白名单表／schema 变化后，必须能恢复并逐项复验到 before digest。

- [一般] `Evidence model`、User Story 3: “every discovered business table”未定义边界，可能漏掉 migration 元数据、legacy 表或新出现的非内部表；而“configured bound”“short-lived”也没有数值，第三方无法判断完整 capture 何时应通过。→ 改为枚举并捕获所有非平台内部的 table／index／trigger／view，内部对象使用封闭且版本化的排除表，未知对象失败关闭；为 D1 rows、R2 objects、单页／总响应大小和确认有效期给出明确值或版本化配置及证据字段（已确认的 recovery confirmation 默认 5 分钟）。

- [一般] `Maintenance boundary`、`Testing Decisions`: “verified owner-only Site access”尚未形成可测试的认证协议；HTTP 测试只覆盖抽象 authentication，Cloudflare-shaped fake 不能证明实际部署会忽略伪造身份头、正确执行分页或禁止跨站副作用。→ 规格应声明身份只能来自受信平台上下文，维护 route 只接受非缓存的状态变更方法并具备 CSRF／Origin 防护，confirmation 的单次使用状态跨实例持久；增加 snapshot-only 预生产部署验收，用真实 Site 身份、D1 fixture 与多页 R2 fixture 验证 owner/非 owner、伪造 header、跨站请求、分页终止、日志脱敏和“部署本身零 migration”。

- [建议] `Evidence model`、`Local evidence handling`: “deployed Site version/source revision expected by the maintainer”若来自 CLI 参数，只能证明调用者的期望，不能证明实际响应来自哪个构建；普通 content hash 也不具备不可变或真实性。→ 由服务端构建元数据产生实际 revision／deployment identity，并在本地将最终 digest 与 CI／维护记录中的可信 revision 交叉核对；文案使用“完整性摘要”，不要把可重新计算的 hash 描述为不可变证明。
