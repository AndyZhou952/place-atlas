# 进度

- 特性: 005-owner-poc-unified-api
- 当前阶段: code-review
- 执行模式: interactive
- 已加载: hf-workflow、hf-to-spec、hf-to-architecture、hf-codebase-design、hf-to-tickets、hf-ui-design、hf-review
- 已完成: 基于现有 AtlasApplication、Web browser adapter、Agent gateway、Catalog intake、Nearby 与 D1 schema 完成现状审计
- 已完成: 用户确认统一应用操作、简单 Owner Login、Web/Agent 不同鉴权、Google 路线与 DeepSeek 职责
- 已完成: 起草 feature、spec、architecture 与内部 ticket graph
- 已完成: 第 1 轮独立 spec/architecture review 结论为需修改；已按发现项补齐公开读取投影、Route Sidecar、raw Secret、hard caps、统一 mutation、seed 与双入口切换
- 已完成: 第 2 轮独立 review 指出公开 DTO、digest 所有权、session 轮换与 Sidecar 公网负测缺口；已按用户最新公开确认完成最小修订
- 已完成: 第 3 轮独立 spec/architecture review 均通过；用户于 2026-09-21 确认规格与架构
- 已完成: 用户确认公开边界：持 URL 者可查看 Catalog、总体评论、Visit 展示与照片原图；internal ID、存储 key、hash、audit 保持私有；只有 Owner 可以写入
- 已完成: 本地实现并验证 Public Read、Owner Auth、T-03 统一 coordinator、T-04 Visit/媒体统一 mutation 与公开投影、T-10 Owner Login 与总体评论 UI
- 已完成: 第 2 轮独立代码评审通过；`POST /api/items` 在 owner-poc 中保持 fail closed，直到 T-12 提供统一 Add operation
- 未完成: 远端 D1/R2 provision、migration/deploy 与 smoke 尚未执行，因此 T-01、T-11 保持未完成
- 未完成: T-05、T-06、T-07、T-08、T-09 及 T-12 之后的 Add/Record 工作均未实现
- 保留门禁: D-P05 仍为 Proposed；T-06 独立安全证据通过前真实 Google 调用继续 fail closed
- 保留门禁: 当前 owner Agent 只是兼容性 Nearby 骨架，仍返回渠道专用 reply；结构化 `nearby.recommend` 尚未实现，T-05 保持未完成
- 下一步: 等待用户确认代码评审结果，再 provision 隔离 D1/R2 并执行 deploy/smoke；当前不进入 ship/done
