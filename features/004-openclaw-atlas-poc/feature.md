# 004 — OpenClaw × Japan Atlas PoC

- 模式: 建造
- 用户可感知: 是
- 骨架: 是

## 目标

让 AWS Lightsail 上常驻的 OpenClaw 通过微信私聊安全调用 Japan Atlas，并优先跑通三个真实日用闭环：

1. 用户给出手动输入的街区／地址，Agent 返回少量附近候选，明确展示距离、个人与外部评分、到访状态、walk-in／排队／预约条件、推荐理由及未知／过期事实；
2. 用户只输入餐厅名，Agent 查重并查找带地址、外部评分与来源的分店候选；有歧义时让用户选择，经预览确认后才建档；
3. 用户围绕一个明确地点连续发送评分、长评与多张图片，Agent 将它们收集成一个可检查、可取消、可重试且不会重复写入的 Visit。

## 已确认的现状

- `AtlasApplication` 已提供框架无关的统一应用入口和 20 个静态操作；D1 保存结构化数据，R2 保存 Visit 图片。
- `decision.nearby` 当前接受坐标、数量和 catalog profile，返回直线距离、食べログ评分和预约快照；它尚不是完整推荐接口。
- `visit.create` 支持稳定 Visit ID、日期、评分与笔记，但纯照片 Visit 尚不合法，且稳定 ID 不等于完整的幂等回执／冲突检测。
- `media.attach` 支持 JPEG、PNG、WebP、GIF，每张最多 8 MB；HTTP 每批最多 4 张，单次网页选择最多 24 张，单 Visit 暂无固定总数上限。
- 当前 HTTP、capabilities 与浏览器 WebMCP 没有可发放给远端 Bot 的服务鉴权、逐操作授权、完整 schema、通用幂等回执或审计边界。
- 当前腾讯微信插件可以接收图片、语音、文件和视频，并把图片解密为本地媒体路径；已安装协议枚举没有原生位置卡片类型。PoC 的位置线索只来自用户手动输入的街区／地址文字，或从 Google Maps 等应用复制出的地址文字。
- 现有 `catalog.save_discovered` 要求调用方一次提供完整 AtlasItem，且新地点必须先进入 `needs_review`；尚无从餐厅名开始的查重、来源查询、消歧、确认与 verified 晋升流程。
- Conversation Coordination、`CatalogIntakeSession`、`VisitCaptureSession`、聊天附件归属、微信消息去重和重启恢复尚未实现。
- AWS 当前 OpenClaw `2026.7.1` 的 skill direct tool dispatch 会按普通 tool allowlist 过滤 optional tool，不能在“不向模型暴露工具”的同时完成 `/jpmap`；规范 slash 入口因此改用官方原生 plugin command，在 agent/model loop 前执行且不注册模型工具。bare alias 与连续 capture 仍须由代码自有的微信入站路由在 agent loop 前实现并通过 capability probe。

## 产品边界

- OpenClaw、DeepSeek 和微信只属于 adapter/runtime；不得直接访问 D1、R2、maintenance 或 reset 能力。
- Agent 只调用明确允许的版本化服务操作；所有硬筛选、状态转移、消息去重、提交和权限判断由应用控制，模型只负责意图与字段候选抽取。
- PoC 只服务已确认的 owner 私聊；群聊、第二账号、破坏性操作、预约／付款／外发消息默认拒绝。
- 首轮使用假数据或非敏感数据完成读写 E2E；聊天中已经暴露的 DeepSeek key 只用于 PoC，上真实私人数据前必须轮换。
- 本特性不执行生产 reset，不绕过 `003-production-snapshot` 的冻结、快照或恢复门。

## 已确认的设计

1. 采用两阶段发布：先跑通只读 Nearby，再开放餐厅建档、Visit 与图片写入。
2. 多消息评价采用“开始记录 → 连续发送 → 完成记录 → 预览 → 确认保存”；自然语言可以建立草稿，但不能跳过预览／确认直接写入。
3. PoC 位置只接受用户手动输入的街区／地址文字或从地图应用复制的地址文字；不建设一次性定位链接，也不等待或修改微信插件的位置卡片支持。
4. VisitCaptureSession 连续 30 分钟无活动时暂停，下次相关消息先询问是否继续；24 小时后过期。提交后的迟到图片只有明确追加到保存回执时才能关联。
5. Nearby 首层按真实步行 10～15 分钟内可达筛选；默认优先未到访。首层无结果时再展示扩大到 2 公里的候选或门到门 20 分钟内、无需换乘的电车候选。个人评分只在 Effective Visited State 为真时出现，且始终与外部评分分开。
6. 步行时间和电车可达性必须来自可验证的路线数据；缺失时只能返回明确标注的距离估算，模型不得编造时间或换乘事实。
7. 用户只给餐厅名、名称加街区，或一个完整地址都可发起 CatalogIntakeSession；服务先查重，再查受控来源以补齐可许可的名称、地址、坐标、外部评分与来源，同名分店由用户消歧，预览确认后才写入。外部评分保留来源／时间且永不冒充个人评分。
8. 单一微信前门通过 OpenClaw 原生 plugin command 确定性识别 `/jpmap`，在模型前处理且不向模型注册 Atlas 工具；严格 `jpmap ...` 与连续 capture 只在代码自有的 pre-model 微信入站路由通过真实 capability probe 后启用。gate 关闭时 bare 输入可作为普通助手文字，但没有任何项目凭证／工具。未来 gym／Bobo Monitor 以独立凭证、工具和状态命名空间注册。
9. 最终附近候选现场核验直接 walk-in 和可得排队事实；只有显式来源可形成肯定结论，单独的“可预约”不代表可 walk-in，无法核验时明确显示未知。
10. Record 最终需要支持总体评分、总体评语、照片及每张照片的细分评分，也要处理用户输入店名与既有 AtlasItem 名称不一致；字段语义、归属、消歧和推断边界在 record 实现前通过独立规格细化门确认，不阻塞 Nearby 与 Catalog tickets。

## 验收方向

- owner 微信私聊能用规范 `/jpmap` 完成仅名称餐厅建档、带 walk-in／排队状态的附近查询及一次多段文字、多图 Visit，地图读取同一持久结果；严格 `jpmap` 别名只有通过 capability gate 才作为等价入口启用。
- 相同渠道消息重复投递不产生重复 Visit 或图片；相同消息 ID 携带不同内容时失败关闭。
- Agent/API/gateway 任一点在提交中重启后可以恢复或重放最终回执，不靠“最近一次 Visit”猜测归属。
- 第二账号、群聊、伪造／过期凭证、越权工具和未确认破坏性动作均被拒绝。
- 弱网、分批图片、部分失败、QR 重连和服务重启通过后，完成七天 soak 与一次纯手机旅行演练。
- 未知命令、相似前缀和其他项目命令不触发 Atlas 写入；规范项目命令及 gate 开启时被入站路由认领的路径证明模型调用为零，其他普通助手路径证明项目工具调用为零，且凭证／状态不串用。
