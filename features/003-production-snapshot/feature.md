# 003 生产快照与 T-14 解锁

- 模式: 建造
- 用户可感知: 否
- 执行模式: auto（用户于 2026-09-12 授权云端持续执行；生产 reset 仍不在本特性授权内）

## 意图

在任何测试状态 reset 或 Agent-ready core 生产切换之前，为当前 owner-only Site 增加一次受控、可验证且不进入 Git 的 D1 逻辑快照、R2 object manifest 与封闭恢复能力，解除 T-14 的备份／回退阻塞。

## 当前事实

- 生产仍运行 Site version 15；Agent-ready version 16 已保存但没有部署。
- version 16 包含尚未在生产执行的 `0003_reset_test_place_assessments.sql`。
- 当前 Sites 工具可枚举 D1 表与分页读取行，但不能导出完整 schema snapshot，也不能列出 R2 object manifest。
- 当前生产八张业务表中只有 `place_assessments` 有三行；其他业务表均为空。用户确认这些个人状态是可丢弃的测试数据，地点记录保留并将在后续统一导入真实内容；该事实不替代完整备份和恢复证据。

## 建造边界

- 把未执行的 reset SQL 按字节与 checksum 原样保存为 pending artifact；新的 active 0003 只建立 maintenance fence/snapshot 控制结构，reset 后续以 active 0004 发布；
- 增加只接受受信平台 owner 身份、默认关闭的 maintenance snapshot/restore route；
- 所有 Web、WebMCP、媒体和未来 Agent mutation 必须共用持久化写入 fence，并在 capture 前排空在途写入；
- 快照包含完整非内部 D1 schema objects、全部业务表和 R2 object inventory；
- 增加本地 capture／验证工具，私人内容只写权限受限的本地临时文件；
- 增加受固定 schema、证据摘要和一次性短时确认约束的完整 D1 restore；不接受任意 SQL；
- 完成 snapshot-only 部署、before capture 和完整恢复演练后，才发布 active 0004 并进入既有 T-14；
- maintenance route 不进入 Agent capability、WebMCP 或普通 UI。

## 非目标

- 通用备份产品、长期在线管理后台或任意 SQL 接口；
- 改变 pending reset 的四字段语义或字节内容；
- 备份进入 Git、日志、模型上下文或第三方存储；
- 在本特性中发布 Agent-ready version 16 或执行 reset；
- Agent runtime、微信、服务 credential 或普通删除恢复。
