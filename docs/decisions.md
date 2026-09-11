# Japan Atlas 决策登记册

最后更新：2026-09-09

本文件合并原 decision log 与 ADR。只保留会影响未来开发的决定；实施过程由 Git 与 GitHub Issues 保存。

状态：

- `Accepted`：当前开发必须遵守；
- `Proposed`：方向合理，但需实验后接受或拒绝；
- `Superseded`：已被新决定替代；
- `Pending`：尚未到决策时点。

## 1. 已接受决策

### D-001：私有单用户、Agent-first、map-first

**状态：Accepted（2026-09-05）**

产品首先服务一个人的长期使用。微信／Agent 是主要采集和指令入口，私有地图是主要浏览、空间整理与记忆入口。Web 写入在 Agent 对等前作为备用入口，两个入口共用同一产品核心。

### D-002：框架无关核心与 Ports & Adapters

**状态：Accepted（2026-09-05）**

领域 API、数据和业务规则不得依赖 OpenClaw、Codex、Claude Code 或其他 harness。渠道、Agent runtime、采集器、地图和存储都通过 adapter 接入；未来通用化不应要求迁移私有数据。

### D-003：Web 使用 MVVM 边界

**状态：Accepted（2026-09-05）**

React View 不直接写数据库或维护第二份业务状态；ViewModel 负责操作、乐观更新、回滚和 API 编排。该模式不强行套用到 worker 或存储内部。

### D-004：先建立持久 API，再接聊天渠道

**状态：Accepted（2026-09-06，原 ADR 0003）**

Web 与未来 Agent 必须先共享可测试的持久操作，不能把聊天层接到内存 fixture。当前 v1 以 D1 保存结构化数据、R2 保存私有媒体；存储仍放在 application port 后面。

**重审条件：** D1 的规模、空间查询、区域延迟或服务限制出现可测量问题时，再评估 Postgres/PostGIS 或独立 API。

### D-005：地点身份、个人评价、Visit 与媒体分离

**状态：Accepted（2026-09-06，原 ADR 0004）**

- `AtlasItem` 是唯一地点身份；
- 每地点只有一个可空总体个人评分；
- Visit 可重复并形成时间线，Visit 不拥有独立评分；
- 媒体二进制在 R2，元数据、说明和 Visit 关系在 D1；
- 个人评分与外部评分严格分离。

这避免重复到访复制地点和产生多个互相冲突的长期评分。

### D-006：可信来源与允许放弃判断

**状态：Accepted（2026-09-05）**

自动确认的精确分店 precision 目标至少 90%。低置信或证据冲突时给出最多三个候选并请求确认；模型自报 confidence 不是概率。外部事实必须保留来源和核验时间。

### D-007：Web Access 是可替换采集器

**状态：Accepted（2026-09-06）**

分享来源是可靠默认入口；登录浏览器支持用户触发的批量 discovery。Web Access 可作为第一实现，但不能成为核心依赖。社交 Cookie 留在本地隔离 profile，连接器只上传规范化证据。

### D-008：外部动作需要确认

**状态：Accepted（2026-09-05）**

删除、预约、付款、取消和对外消息需要明确确认。所有写入需要类型校验、幂等、权限控制和审计 receipt；Agent 不获得任意 shell、文件或存储权限。

### D-009：个人状态与筛选语义

**状态：Accepted（2026-09-06，2026-09-07 补充）**

- `isFavorite` 是独立喜欢状态，不等同于候选／保存／计划；
- 存在 Visit 一定意味着去过；无 Visit 时可以显式标记 `行った`；
- 喜欢与到访筛选可以同时启用，同时启用时为逻辑 AND；
- 推荐默认优先没去过，除非用户明确要求重访或喜欢。

### D-010：评分输入与展示

**状态：Accepted（2026-09-07）**

个人评分可空，范围 0–5，`0` 有效；手动输入四舍五入到一位小数，spinner 按 0.5。个人评分与来源评分并排显示，来源核验时间在详情底部统一展示一次。

### D-011：分栏地图与稳定交互

**状态：Accepted（2026-09-07）**

分栏侧边栏 B 是默认布局。喜欢用纯心形；到访固定显示 `行った`。个人操作采用乐观更新。地图复用 marker，不使用整画布 filter／blur，并保持 provider-neutral adapter。

### D-012：当前 Visit 的最低内容与评分副作用

**状态：Accepted（2026-09-09，统一既有要求）**

当前网页／API 显式记录一次 Visit 时，评分或笔记至少存在一项，照片可以在同一动作选择；只有评分、没有笔记也合法。Journal 可在创建 Visit 的同一动作更新地点评分。单独从详情修改长期评分只更新 `PlaceAssessment`，不得自动创建 Visit。纯照片 Visit 只有在未来 capture session 能提供明确地点与生命周期后才可实现。

### D-013：批量图片与对话式关联

**状态：Accepted（2026-09-08）**

网页一次可选择 24 张，底层每请求四张，单 Visit 不设固定总数。未来聊天图片通过用户＋conversation＋明确地点范围的 `VisitCaptureSession` 关联；显式 session／回复优先，歧义必须询问，渠道 message ID 保证幂等。详细跟踪见 [#4](https://github.com/AndyZhou952/jp-food-event-map/issues/4)。

### D-014：大图库使用弹窗

**状态：Accepted（2026-09-09）**

Visit 时间线最多先展示四张缩略图；完整集合在单图弹窗中浏览，支持按钮、键盘、触屏滑动和相邻预加载。图库交互不能改变底层媒体／ViewModel 契约。

### D-015：性能依靠证据和后台对账

**状态：Accepted（2026-09-07 至 2026-09-08）**

Journal 前台不等待私有 Sites 约两秒的鉴权／运行时回包；ViewModel 乐观更新并在失败时恢复。Visit create/edit/delete 各限制为两次 D1 binding 往返且不全表读取。地图更换引擎前必须先取得托管 trace；见 [#1](https://github.com/AndyZhou952/jp-food-event-map/issues/1)。

## 2. 提议中决策

### D-P01：OpenClaw 作为首个微信 runtime

**状态：Proposed（原 ADR 0001）**

OpenClaw 是当前首选，因为它提供接近目标的微信 gateway/plugin 能力。它必须位于 `ChannelAdapter` 与 `AgentRuntime` 后，只能调用 scoped tools。

**接受条件：** 主账号私聊 PoC、工具正确性、安全门禁、重连与七天 soak 通过。

**重审条件：** 插件维护、追踪／回放、权限或稳定性不满足要求；此时比较 Hermes/Pi 或 code-owned SDK adapter。

### D-P02：云端常驻核心＋本地按需采集

**状态：Proposed（原 ADR 0002）**

消息 gateway、API、轻量 worker 和提醒常驻云端；社交平台登录浏览器留在本机按需运行，只上传规范化 manifest。

**接受条件：** 微信 PoC 证明 24/7 需求，且本地 connector 同步协议可恢复。

**重审条件：** 出现稳定官方 API、安全隔离的云浏览器，或本地可用性妨碍真实需求。

## 3. 已替代决策

| 旧方向 | 状态 | 当前方向 |
|---|---|---|
| 旧 `food-map` 代码／数据作为基线 | Superseded | 只借鉴个别体验，从零构建，不迁移旧代码、依赖或样例数据 |
| 静态 JSON／Git 作为数据库 | Superseded | D1/R2 与唯一应用 API 写边界 |
| 每条 Journal 记录拥有评分 | Superseded | 每地点一个 PlaceAssessment，Visit 独立可重复 |
| 大图库在时间线内全部展开 | Superseded | 四缩略图＋单图弹窗 |
| 媒体只能保存 Visit 后追加 | Superseded | Journal 创建时可同步选择图片，同时保留后续追加 |
| 一开始全面处理创作者历史 | Superseded | Discovery 后只 enrichment 选中／高相关内容 |
| Postgres/PostGIS 是近期既定迁移 | Superseded | D1/R2 为 v1 基线，达到明确触发条件再评估 |

## 4. 待决策

| 问题 | 最晚决策时点 | 所需证据／建议 |
|---|---|---|
| OpenClaw 是否最终采用 | 微信 adapter 开发前 | 统一 runtime 场景、主账号 PoC 和安全评审 |
| 24/7 API/gateway 的 host、region 与预算 | 微信 PoC 通过后 | APAC/EU 实测延迟、月成本、备份与运维可靠性 |
| Sites owner-only 与 Bot 的服务鉴权边界 | 发放任何云端 Agent credential 前 | scoped API 原型、签名、权限和审计测试 |
| 是否更换地图引擎／瓦片供应商 | #1 trace 后 | 当前 Leaflet/OSM 与合规矢量方案的移动端数据 |
| 删除最后一条 Visit 后是否保留人工 `行った` | 引入更完整审计／恢复模型前 | 建议三态 override；当前实现会对账为未到访；一致性见 [#5](https://github.com/AndyZhou952/jp-food-event-map/issues/5) |
| 每月基础设施与模型预算 | 采购云资源前 | 实际消息量、媒体、模型与日志成本 |

这些事项尚未阻塞当前 application layer 和采集器开发。到达决策点时，应在 Issue 中附证据，再将结果更新为 `Accepted` 或 `Rejected/Superseded`。
