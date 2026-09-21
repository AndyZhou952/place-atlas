# Japan Atlas

一个把日本地点发现、现场决策与个人到访记忆统一到同一可信集合中的私有产品上下文。

## 语言

### 地点与事实

**Atlas 条目（AtlasItem）**：
餐厅、咖啡店、建筑、活动或展览在产品中的唯一规范身份。
_Avoid_：卡片、收藏项、Journal 项目

**来源断言（Source Assertion）**：
由外部来源支持、包含证据位置与核验时间的一项事实。
_Avoid_：永久事实、模型结论

**可信条目（Verified Item）**：
身份与关键字段已达到发布证据要求、可以出现在默认地图集合中的 Atlas 条目。
_Avoid_：自动抓取结果

**审核候选（Review Candidate）**：
证据不足或冲突、必须由用户确认后才能成为可信条目的候选身份。
_Avoid_：低分条目、错误条目

### 个人记忆

**地点评价（PlaceAssessment）**：
一个 Atlas 条目唯一且可空的长期个人评分、喜欢与个人状态记录。
_Avoid_：Visit 评分、食べログ评分

**到访（Visit）**：
用户在某一日期对一个 Atlas 条目的单次实际经历，可包含笔记与媒体。
_Avoid_：地点、评分卡、Journal 条目

**到访媒体（VisitMedia）**：
明确归属于一次 Visit、具有稳定身份、顺序与可选说明的私有图片。
_Avoid_：来源关键帧、第三方帖子媒体

**有效到访状态（Effective Visited State）**：
用于展示与推荐的去过／没去过结果；其不变量为 `存在 Visit OR manualVisited`，真实 Visit 不能被人工状态隐藏。
_Avoid_：Visit 数量、收藏状态

**回收站条目（Trash Entry）**：
普通删除后保留 30 天、可恢复且不出现在正常查询中的地点、Visit 或媒体记录；到期后才清理主存储对象。
_Avoid_：永久删除、隐藏状态

### 采集与 Agent

**导入任务（ImportJob）**：
用户发起、可恢复并可观察进度的一次来源采集请求。
_Avoid_：后台脚本、可信地点

**证据清单（Evidence Manifest）**：
连接器输出的版本化来源记录，保存原始线索、提取方法和证据定位，不直接代表可信结论。
_Avoid_：Atlas 条目、模型摘要

**到访采集会话（VisitCaptureSession）**：
把同一认证用户和对话中的连续评分、笔记与照片安全关联到一个明确地点／Visit 的短时上下文。
_Avoid_：最近一次 Visit、聊天历史猜测

**位置线索（Location Hint）**：
用户手动输入的街区或地址文字，用于解析附近查询的候选地点；它不是可信坐标或路线事实。
_Avoid_：当前位置、微信定位、模型坐标

**可达候选（Reachable Candidate）**：
具有可验证步行或公共交通路线证据的附近 Atlas 条目；没有路线证据的结果只能称为距离候选。
_Avoid_：附近地点、模型推荐

**地点建档会话（CatalogIntakeSession）**：
把餐厅名解析为带来源证据的分店候选，经查重、消歧、预览和 owner 确认后创建或核验 AtlasItem 的短时上下文。
_Avoid_：模型自动建店、只按名称合并、ImportJob

**项目命令路由器（ProjectCommandRouter）**：
在模型参与前，按显式项目命令和闭合子命令语法，把消息确定性分发到对应项目 adapter、凭证与状态命名空间。
_Avoid_：模型意图路由、OpenClaw channel binding、通用工具选择

**到店可行性快照（EntryAccessSnapshot）**：
带来源与核验时间的 walk-in、预约要求和可选实时排队事实；未知信息保持未知。
_Avoid_：可预约、模型估计排队、营业状态

**第三方原始媒体（Third-party Raw Media）**：
仅为提取证据临时取得的帖子图片、视频或音频，处理完成后最多保留 72 小时，不等同于可长期保存的 Evidence Manifest。
_Avoid_：VisitMedia、来源证据

**应用操作（Application Operation）**：
供 Web、Agent 与采集器共同调用、具有类型化输入输出和一致业务语义的产品能力。
_Avoid_：数据库调用、页面事件、Agent tool 实现

**渠道适配器（ChannelAdapter）**：
把特定消息渠道的事件与回复转换为应用操作的可替换边界。
_Avoid_：Agent runtime、产品核心

**Agent 运行时（AgentRuntime）**：
负责理解消息、选择受限工具与编排对话，但不拥有持久产品数据的可替换执行环境。
_Avoid_：数据库、微信插件、领域模型

**Journal**：
当前用于新增、纠正和回顾 Visit 的过渡网页界面，不是持久领域实体。
_Avoid_：Visit、长期一级入口

## 当前实现边界

- Web、WebMCP 与未来渠道统一经类型化 `AtlasApplication` 调用 20 个静态 operation；只有 `media.open` 返回媒体流，其余操作返回闭合 JSON `Result`。
- Import、Catalog、Assessment、Decision、Visit、Destructive 与 Media 七个 group 只在服务器组合根装配一次；Product Core 不依赖 React、Next、D1/R2 或渠道 SDK。
- 浏览器遵循 `View → ViewModel → Browser AtlasApplication adapter`；持久事实来自服务器，乐观状态使用可失效的读取 token 防止旧请求覆盖已提交结果。
- Search、评分归一化与有效到访状态各只有一个 Product Core policy；HTTP、Browser、capabilities 与 WebMCP 共用一份 operation-to-transport mapping。
- 架构适应度测试使用 TypeScript AST 与受控坏 fixture，持续检查依赖方向、无环、唯一 catalog/mapping/policy、adapter 薄层及公开诊断脱敏。
- `0003_reset_test_place_assessments.sql` 与本地维护工具已生成并通过离线安全演练，但尚未部署或执行；生产切换只允许在 T-14 用户批准的维护窗口进行。
