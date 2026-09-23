# Japan Atlas 路线图与任务看板

状态：有效执行摘要
最后更新：2026-09-12

详细实验、验收记录和低优先级工作由 GitHub Issues 跟踪。本文件只维护阶段、依赖、当前状态和下一检查点。

## 1. 阶段定义

| 阶段 | 含义 | 完成标志 |
|---|---|---|
| 实验阶段 | 解决架构与集成不确定性 | “来源→地图”和“含照片到访→地图”两条闭环可运行 |
| Demo 阶段 | 核心闭环在人工保护下端到端可用 | Agent、采集、审核、媒体和地图协同 |
| 成型阶段 | 足以供个人日常使用 | 微信连续七天、备份恢复和移动体验通过 |
| 交付阶段 | 可承担旅居期间真实使用 | 纯手机演练完成，无需开发工具干预 |

**当前：实验阶段。** Web 与媒体垂直切片真实可用；Agent-ready 应用核心已完成本地实现、独立评审与 PR CI，正在等待用户批准生产维护窗口。生产切换后，下一主线是服务安全／写入可靠性，然后才是采集器和微信渠道。

## 2. 当前能力快照

已完成并作为后续基线：

- 私有仓库、仅所有者 Site、D1 和不可变 migration；
- 可信初始目录、日文优先名称、来源和预约／活动字段；
- 分栏地图、确定性多语言／标签搜索、组合筛选；
- 每地点一个可空个人评分，可重复 Visit、喜欢和到访状态；
- Journal 新增／编辑／删除、地点与日期筛选、乐观更新和幂等 Visit；
- R2 私有图片、D1 媒体元数据、批量上传、说明、删除和图库弹窗；
- Leaflet adapter、marker 对账和基础性能修正；
- WebMCP 浏览器操作与 Web UI 共用 API；
- 框架无关 `AtlasApplication`、20 个类型化操作和七个领域组；
- Browser MVVM adapter、乐观回滚与 stale-load 防护；
- Search、评分归一化、有效到访状态和 HTTP mapping 均只有一个产品实现；
- AST 架构适应度门、迁移安全测试和独立代码评审；
- PR/main 的完整 CI。

## 3. 按依赖排序的任务

状态：`完成`、`进行中`、`下一步`、`受阻`、`以后`。

| ID | 大类 | 交付物 | 前置 | 状态 | 目标阶段 |
|---|---|---|---|---|---|
| DOC-03 | 文档 | 中文核心文档、统一决策与 Issue 跟踪规则 | — | 完成 | 实验 |
| MAP-04 | 地图性能 | 托管环境 trace 和移动端验收；必要时比较矢量方案 | 当前 adapter | 进行中，[#1](https://github.com/AndyZhou952/jp-food-event-map/issues/1) | 实验 |
| MEDIA-02 | 媒体加固 | 服务端可信尺寸、缩略图、失败批次重试、孤儿清理与指标 | 现有媒体链路 | 进行中，[#4](https://github.com/AndyZhou952/jp-food-event-map/issues/4) | 实验 |
| OPS-00 | 生产快照安全 | owner-only snapshot/restore、全入口写入 fence、托管证明与 snapshot-only compatibility build | APP-01 | 进行中，[feature 003](../features/003-production-snapshot/tickets.md) | 实验 |
| CORE-14 | 生产切换 | 经批准后备份、四字段测试状态 reset、部署、对账与回退验证 | OPS-00、Agent-ready core PR CI | 受阻，需人工批准窗口 | 实验 |
| APP-01 | 应用边界 | 从 D1 store 抽取框架无关 ports/use cases | 当前 API | 完成 | 实验 |
| APP-02 | 写入可靠性 | 通用幂等键、审计 receipt 和可恢复删除策略 | APP-01 | 下一步 | 实验 |
| AGENT-01 | 类型化操作 | search/recommend/place/Visit/rating/tag/media/import 工具 | APP-01 | 完成 | 实验 |
| AGENT-02 | 服务安全 | scoped authentication、授权、签名和逐工具权限 | APP-01、APP-02 | 受阻 | 实验 |
| VIEW-01 | View 重构 | 拆分列表、详情、Visit 时间线与图库组件 | 当前 ViewModel | 以后 | 实验 |
| ACQ-01 | 采集环境 | 独立浏览器 profile、小号和本地 loopback connector | APP-01 | 受阻 | 实验 |
| ACQ-02 | Discovery | 小批来源枚举和不可变 evidence manifest | ACQ-01 | 受阻 | 实验 |
| ACQ-03 | Enrichment | 正文／评论、ASR、关键帧、OCR 和候选生成 | ACQ-02 | 受阻 | Demo |
| ACQ-04 | 身份审核 | 精确分店解析、abstain 和最多三候选审核 | ACQ-03、AGENT-01 | 受阻 | Demo |
| EVAL-01 | 领域校准 | smoke 后运行约 30 条校准，再决定是否扩至 150 | ACQ-04 | 受阻 | Demo |
| HARNESS-01 | Runtime 契约 | 共享 AgentRuntime 与 mocked tool suite | AGENT-01、AGENT-02 | 受阻 | Demo |
| HARNESS-02 | Harness 选择 | 以本项目任务比较候选并更新决策 | HARNESS-01 | 受阻 | Demo |
| MEDIA-06 | 对话式照片 | capture session、message 幂等、歧义确认和 reply caption | AGENT-01、AGENT-02 | 受阻，[#4](https://github.com/AndyZhou952/jp-food-event-map/issues/4) | Demo |
| WX-01 | 微信 PoC | 主账号私聊的文字、链接、图片、语音和位置往返 | HARNESS-02 | 受阻 | Demo |
| WX-02 | 渠道适配 | 微信消息映射到同一应用操作，支持回执、进度和深链接 | WX-01、AGENT-02 | 受阻 | Demo |
| WX-03 | 可靠性 | 重复投递、重试、重启、重新登录和连续七天 soak | WX-02、MEDIA-06 | 受阻 | 成型 |
| CLOUD-01 | 24/7 托管 | 按实测选择 region/provider/API 边界和预算 | WX-01 | 受阻 | 成型 |
| OPS-01 | 运维 | 版本锁定、监控、加密备份和恢复演练 | CLOUD-01 | 受阻 | 成型 |
| OPS-02 | 旅行体验 | 手机优先、弱网和最后同步数据 | MAP-04 | 以后 | 成型 |
| OPS-03 | 新鲜度 | 预约／活动刷新和 JST 提醒 | AGENT-02 | 以后 | 成型 |
| QA-01 | 交付演练 | 一周纯手机旅行演练 | WX-03、OPS-01、OPS-02 | 受阻 | 交付 |
| PORT-01 | 后续通用化 | 清理私有数据并抽取可配置公共主干 | QA-01 | 以后，v1 后 | 交付后 |

## 4. 当前执行顺序

1. 先按 feature 003 完成 `OPS-00`：真实托管硬门、完整 snapshot/restore、snapshot-only compatibility build；任何证明缺失均失败关闭。
2. `OPS-00` 完成后，仍须用户批准具体维护窗口才执行 `CORE-14`；此前不部署 active 0004 或 reset。
3. 补通用幂等、授权、审计 receipt 和可恢复删除边界；媒体缩略图等低风险体验项继续放在 #4。
4. 用非微信测试 adapter 验证所有 20 个日常操作及负面授权场景。
5. 准备独立浏览器，完成范围受控的来源采集→证据→审核实验。
6. 运行校准数据后确认自动判断／人工审核取舍。
7. 实现并比较 Agent runtime，再做微信私聊 PoC。
8. PoC 成功后才选择 24/7 region/provider，随后做稳定性和旅行演练。

地图 #1 不阻塞第 3–7 步，除非已经影响基本数据操作。View 拆分也不应阻塞应用层抽取。

## 5. 里程碑验收

### M1：媒体闭环关闭

- 图片在正确 Visit 下持久化并可恢复；
- 部分失败只重试失败批次，不复制成功图片；
- D1 与 R2 可以对账并清理孤儿对象。

### M2：Agent-ready 产品核心

- [x] 测试 adapter 无需导入 React、D1 或 R2 即可完成所有日常操作；
- [x] Web UI、capabilities 与 WebMCP 共用同一应用操作和 HTTP mapping；
- [ ] 服务凭证、授权、通用幂等和审计通过负面测试。

### M3：来源采集闭环

- 一个用户指定来源可重复地产生 evidence manifest；
- 自动确认达到精确分店目标，剩余内容进入快速审核；
- 局部失败可见且可恢复。

### M4：微信闭环

- 日常采集、附近推荐、纠错、Visit 和照片均可从微信发起并显示在地图；
- 歧义和破坏性操作会确认；重复消息不会重复写入。

### M5：旅行交付

- 七天稳定运行；
- 备份恢复通过；
- 弱网与纯手机演练通过；
- 无需直接数据库或开发工具干预。

## 6. Issue 使用方式

- [#3](https://github.com/AndyZhou952/jp-food-event-map/issues/3)：跨里程碑主 RFC 和长期交付讨论。
- [#4](https://github.com/AndyZhou952/jp-food-event-map/issues/4)：对话式图片、大图库和媒体加固。
- [#1](https://github.com/AndyZhou952/jp-food-event-map/issues/1)：非阻塞地图性能跟踪。
- [#5](https://github.com/AndyZhou952/jp-food-event-map/issues/5)：Visit 推导状态与个人状态 mutation 的一致性。
- 已关闭 Issue 保留实施与测量证据；本文件只吸收仍有效的约束。

每个新 Issue 应说明背景、非目标、依赖、验收标准和关闭证据。低优先级性能项留在 Issue，不应反复扩写核心文档。
