# 规格 — 004 OpenClaw × Japan Atlas PoC

## Problem Statement

Japan Atlas 已经用 `AtlasApplication` 统一了地点、个人状态、Visit、媒体和 nearby 等持久化操作，AWS Lightsail 上的 OpenClaw、DeepSeek 与微信文字消息也已跑通。但两端之间仍没有适合长期日用的受控服务边界：现有 WebMCP 只能在浏览器页面中工作，现有 HTTP route 没有 Bot 服务身份、逐操作权限、完整 schema、通用幂等回执或渠道审计；现有地点创建还要求调用方一次提供完整 AtlasItem，不能从一个餐厅名安全完成查找、消歧、来源核验和确认建档。

因此，直接让 OpenClaw 调用现有私有 HTTP route 会带来三类用户可见风险：Agent 无法可靠理解手动输入的街区／地址并返回可信可达范围；重复或乱序微信消息可能产生重复 Visit／图片；多段文字和多张图片没有一个明确的草稿与提交边界，可能归错地点或在尚未说完时写入真实 Visit／PlaceAssessment／VisitMedia。

## Solution

在既有 `AtlasApplication` 外建立一个运行时无关的 Agent 服务边界，并在其上实现附近决策、餐厅建档与到访采集三个纵向切片。OpenClaw 只负责把微信消息转换为版本化的渠道事件、调用被授权的窄工具并呈现结果；地点解析、外部事实来源、路线证据、硬筛选、会话状态、幂等、提交和权限均由 Japan Atlas 控制。

PoC 分两阶段发布：

1. 只读阶段先在隔离假数据环境跑通“手动街区／地址文字 → 可信附近候选 → 微信解释结果”，并证明服务鉴权、owner 绑定、工具 scope、错误脱敏与日志边界。
2. 写入阶段再加入 `CatalogIntakeSession` 与 `VisitCaptureSession`，先跑通“餐厅名 → 候选资料 → 消歧／预览 → 确认建档”，再跑通“开始记录 → 连续文字／图片 → 完成记录预览 → 确认保存 → 地图读取同一 Visit”，并证明重复、部分失败和重启不会造成重复、错误归属或未经确认的地点。

## User Stories

1. 作为 Japan Atlas owner，我希望在微信中输入街区或从 Google Maps 等应用复制的地址文字，就能查询附近值得去的地点，而不需要发送实时定位。
2. 作为用户，我希望地址不明确或对应多个候选时 Agent 先让我选择，而不是猜一个坐标。
3. 作为用户，我希望默认先看到真实步行 10～15 分钟内可达、尚未到访的可信地点，从而优先发现新选择。
4. 作为用户，我希望步行范围没有结果时，看到明确分组的 2 公里扩大候选和无需换乘电车候选，而不是得到“附近没有”的死胡同。
5. 作为用户，我希望每个推荐同时显示距离／路线、个人评分、外部评分、到访状态、能否直接 walk in、排队信息、预约条件、推荐理由和未知／过期事实，并清楚区分个人与外部评分。
6. 作为用户，我希望说“开始记录 店名”后可以连续发送多段评价和多张图片，而不必把内容整理成一条长消息。
7. 作为用户，我希望自然语言也能建立评价草稿，但任何自然语言推断都不能跳过预览和确认直接写入真实 Visit／PlaceAssessment／VisitMedia。
8. 作为用户，我希望“完成记录”只展示地点、日期、评分、整合笔记、图片数和图片说明；只有我说“确认保存”后才真正写入。
9. 作为用户，我希望能随时“查看记录”“继续补充”或“取消记录”，并在地点、评分或图片说明有冲突时得到简短澄清。
10. 作为用户，我希望短暂中断后仍能继续草稿，同时旧草稿不会长期占用私人存储。
11. 作为用户，我希望微信或服务器重复投递同一条消息时只得到一个 Visit／一份图片；同一消息标识若携带不同内容则拒绝并提示冲突。
12. 作为用户，我希望 Agent/API/gateway 在提交中重启后能恢复或重放最终回执，不需要靠“最近一次 Visit”猜测。
13. 作为 owner，我希望只有我的已允许私聊身份能够使用 Atlas 工具，第二账号、群聊和伪造渠道上下文都被拒绝。
14. 作为 owner，我希望单一微信助手先用确定性项目命令选择 Japan Atlas，再只取得本阶段允许的 Atlas 凭证和工具，不能借助 shell、任意 URL 或其他项目绕过 Atlas API。
15. 作为 owner，我希望先在隔离假数据上验证完整链路，并在轮换已暴露的 DeepSeek key 后才允许真实私人数据进入 PoC。
16. 作为用户，我希望只输入一个餐厅名或说“把这家店加入地图”，Agent 就能查找候选并整理地址、区域、坐标、外部评分和来源，而不要求我填写完整表单。
17. 作为用户，我希望同名店或多家分店出现时 Agent 最多给出三个带地址／区域的候选让我选择，不得擅自猜测分店。
18. 作为用户，我希望入库前看到明确预览，并只有在确认具体候选后才创建地点；来源拿不到的字段必须显示未知，不能由模型补写。
19. 作为用户，我希望 Agent 先检查 Atlas 中是否已有同一餐厅／分店，避免重复建档；若已存在则直接展示已有记录并可继续开始 Visit 记录。
20. 作为用户，我希望外部评分带平台、原始链接、核验时间和可选评论数，且绝不写进我的个人评分。
21. 作为用户，我希望 `/jpmap nearby ...`、`/jpmap add ...` 和 `/jpmap record ...` 在模型参与前就被确定性分发，不会因为模型换了或提示词变化而误调用其他项目。
22. 作为用户，我希望也能使用严格匹配的 `jpmap ...` 便捷写法；写错、漏参数或使用未知子命令时只看到固定帮助，不发生猜测或写入。
23. 作为用户，我希望 `record start` 后连续发送的普通文字和图片进入当前 Atlas 草稿，但 `/gym`、`/bobo` 等其他已登记项目命令仍去各自项目，绝不会被当成餐厅评价。
24. 作为 owner，我希望未来加入 gym、Bobo Monitor 等项目时只登记新的命令、adapter、凭证和状态命名空间，不让一个项目取得另一个项目的数据权限。

## Implementation Decisions

### 1. 范围与部署边界

- `jp-food-event-map` 继续是 Japan Atlas 产品代码、契约和部署配置的唯一源仓库。OpenClaw 不通过克隆仓库或执行仓库命令来完成产品操作。
- PoC 的 Atlas API／前端运行于独立 Cloudflare 环境，使用隔离 D1/R2 fixture；AWS Lightsail 只运行 OpenClaw、微信 adapter 和 Atlas client adapter。
- 当前 OpenAI Sites 生产环境、生产 D1/R2、feature 003 snapshot 以及 `001/T-14` reset 均不被本 PoC 修改或绕过。
- OpenClaw、DeepSeek、腾讯微信插件和未来替代 runtime 都位于 `ChannelAdapter`／`AgentRuntime` 边界外；产品核心不导入其 SDK。
- 同一 OpenClaw 实例使用一个微信前门和确定性 `ProjectCommandRouter`。每个项目仍有独立凭证、最小工具清单和状态命名空间；专用 workspace 可作为后续隔离手段，但任何调用 Atlas 数据的路径都必须通过 Atlas API 的服务端鉴权和 scope 检查。

### 2. Agent 服务契约与安全

- 提供一个版本化、闭合 schema 的 Agent tool manifest；每个工具声明稳定名称、输入／输出 schema、`read | write | destructive` effect、所需 scope、确认策略和可重试语义。
- 第一阶段凭证只授予附近查询所需的 read scope；写入、删除、maintenance 和 reset 工具不得出现在可见清单中。第二阶段只增加 CatalogIntakeSession、VisitCaptureSession 及必要的 Catalog／Visit／Media write scope，destructive 仍不开放。
- 每个请求必须同时通过可信服务身份、owner/channel/conversation 约束和 operation scope。渠道身份不能只靠可任意伪造的普通 header；具体签名或短期令牌协议在特性架构中确定。
- 对外稳定错误至少区分 `invalid_input`、`unauthorized`、`forbidden`、`not_found`、`conflict`、`dependency_failure` 与 `unexpected_failure`，且不泄露 token、内部路径、D1/R2 名称、堆栈、供应商正文或私人内容。
- 结构化审计记录 actor、channel、conversation、operation、message/mutation ID、结果类别和耗时，不记录凭证、图片二进制或私人笔记全文。

### 3. 确定性项目命令路由

- 单一微信前门维护一个显式 project registry。PoC 登记 `/jpmap`；未来 `/gym`、`/bobo` 等使用同一注册机制。项目选择、权限选择和状态命名空间选择均在模型调用前完成。
- `/jpmap` 是唯一保证可用的规范入口：由 OpenClaw 插件的原生 `registerCommand` 在 agent/model loop 前接收 raw arguments，不注册任何可供模型选择的 tool。平台 `requireAuth` 通过后，adapter 仍须精确校验运行时 sender、channel、from/to 与无 thread 上下文，再调用签名 Worker。该路径仍须在实际 AWS 版本和腾讯微信 gateway 上保存版本、commit、配置和零模型调用 trace 后才通过 Read-only gate。
- 首个 ASCII token 严格等于小写 `jpmap` 的无斜杠别名是 capability-gated 便利功能。只有代码自有的微信入站 `PreModelIngressRouter` 在调用 OpenClaw agent loop 前，对匹配、歧义、非匹配、普通文字、图片和重启后路径的 handler/provider-call counter 验收全部通过，才启用 bare alias 和多消息 capture；它不依赖 `before_agent_reply`。证据缺失、版本改变或探针失败时 write gate 保持关闭，bare 输入按普通助手文字处理且不取得任何项目凭证／工具。
- 闭合语法至少包含：`nearby <地址或街区的全部剩余文字>`、`add <餐厅名或完整地址的全部剩余文字>`、`add --name "<餐厅名>" [--near "<位置提示>"]`、`add --address "<完整地址>"`、`record start <地点的全部剩余文字>`、`record status`、`record end`、`record confirm`、`record resume`、`record cancel` 和 `help`。兼容 `record <地点>` 仅作为 `record start <地点>` 的确定性别名；`add` 永不因单一搜索结果自动写库。
- 项目 token 和控制字区分 ASCII 大小写，只接受上述小写形式；自由文字保留 Unicode。双引号参数只允许反斜杠和双引号转义；未知／重复 flag、空值、未闭合引号、缺少必填参数或控制命令后的尾随参数均返回唯一 `invalid_input`，不触发项目工具、模型或状态变化。
- 微信路径顺序固定为：`PreModelIngressRouter` 先处理已启用的严格 bare alias、bare 疑似命令防火墙和 active capture 普通内容；未认领消息再进入 OpenClaw command layer，由平台先消费保留命令，再由原生 plugin command 处理已登记的规范 slash 项目命令，最后才是普通助手模型。未知 slash 命令由 OpenClaw 自身处理；无论其拒绝还是进入普通助手，都不取得项目凭证／工具且不能改变项目状态。
- capability gate 关闭时，bare `jpmap`、`jpmapx` 和普通文字都进入无项目凭证的普通助手，且系统不得创建 active capture。gate 开启时，ingress router claim 严格 bare alias，以及首个 ASCII token 与已登记项目 token 共享前缀但不精确相等的 bare 疑似命令（如 `jpmapx`）；后者返回固定帮助、不进入 Atlas 草稿或模型。普通聊天不 claim。active capture 在 `capturing` 时接受普通文字／图片；`paused` 或 `ready_to_commit` 时返回 `resume_required` 且不追加，其他终态沿用状态表；其他已登记项目命令保持 Atlas capture 原状态及计时。
- registry 中每条 route 明确绑定 project ID、允许的 command schema、adapter、服务凭证、tool allowlist、状态前缀和审计标签。router 不向模型或其他项目暴露凭证；不存在从通用 shell、任意 URL 或跨项目工具退回执行的路径。
- OpenClaw channel/account/peer bindings 只用于不同渠道或账号的静态分流，不用于识别消息正文中的 `jpmap` 前缀。模型仅在 route 已确定且权限已收窄后参与餐厅名、评价文字等语义字段候选抽取，不能决定项目、授权或状态转移。

### 4. 位置线索与附近决策

- PoC 只接受用户手动输入的街区／地址文字，或从地图应用复制出的地址文字。不建设定位网页，不依赖微信位置卡片，也不承诺解析地图分享链接；收到链接时可要求用户复制地址正文。
- `Location Hint` 只是非可信文字；命令层必须原样接受中文、日文或英文地名（例如 `银座`、`銀座`、`ginza`）。位置解析必须经可替换的 `LocationResolver` 返回 `resolved | ambiguous | unresolved`、规范地址、坐标候选和来源；可选模型只能辅助提取／改写地点文字，模型产生的经纬度不能直接进入 nearby。
- Core 不解释或比较供应商／模型自报的 confidence 数值；resolver adapter 必须用供应商特定的确定性规则产出上述三态，并以 contract fixture 证明唯一、歧义、空结果和错误映射。只有 `resolved` 且规范地址与坐标齐全才能进入路线查询。
- 零候选时请求更具体的地址；多个合理候选时最多返回三个供用户选择；只有 resolver 返回 `resolved` 且规范地址与坐标齐全时才能继续。
- 默认查询只使用 `verified_catalog`。用户问餐厅时硬筛选 `food`；其他类型只在用户明确请求或使用泛化查询时出现。
- Nearby 的候选全集只能来自 Japan Atlas Catalog；不得调用 `PlaceDiscoveryProvider`、Foursquare、Places Text Search 或模型去发现未收录餐厅。地点发现只属于独立的 Catalog intake 流程。
- 第一层候选必须有可验证的步行路线且预计时间不超过 15 分钟；15 分钟是将用户确认的 10～15 分钟范围落地为可测试硬上限的 PoC 默认值。默认先排未到访，再按可验证行程时间和稳定 tie-break 排序，最多返回五项。用户明确要求“最近”“去过”或其他条件时覆盖对应默认偏好。
- 第一层无候选时才返回扩展层：直线距离不超过 2 公里的距离候选，以及有可验证公共交通证据、门到门总行程不超过 20 分钟的无需换乘候选。
- 路线证据必须规范化为 `fresh | stale | unavailable` 并带核验时间；PoC 不跨请求缓存路线，只有当前 nearby 请求现场取得的成功结果为 `fresh`，也只有 `fresh` 能支持“步行 N 分钟”或“电车直达”。旧证据一律为 `stale`，失败或缺失为 `unavailable`，二者只能显示明确标注的直线距离估算及 warning。
- 在最终排序后的最多五个候选上现场取得 `EntryAccessSnapshot`，其中两个 assertion 各自保存 provenance：`walkInAssertion.status = confirmed | reservation_required | unknown`；`queueAssertion.status = none_reported | waiting_reported | unknown`。每个 assertion 独立包含来源 URL、`checkedAt` 和 warning；`waiting_reported` 可带等待分钟数，没有分钟数表示“已报告在排队但时长未知”，`none_reported` 明确表示来源报告当前无需排队。
- 只有明确说明可直接到店或必须预约的允许来源才能决定 walk-in；“可预约”、营业中或模型判断都不能证明 walk-in。只有当前请求可核验且带时间的明确排队事实才能决定 `none_reported | waiting_reported`，否则保持 `unknown`。一项核验失败不覆盖另一项成功 assertion，也不会移除候选，但失败项必须显示未知和 warning。
- 每个结果至少包含 item ID、规范名称、类型、区域、地址、直线距离、可选路线证据、是否到访、到访次数／最近到访、EntryAccessSnapshot、预约快照、外部评分来源与核验时间、匹配理由、未知／过期事实和地图深链。
- 个人评分仍存储于 `PlaceAssessment.overallRating`，但 nearby 只在评分存在且 `Effective Visited State` 为真（存在 Visit 或 `manualVisited` 为真）时展示；合法存在但尚未有效到访的评分保持隐藏。它与食べログ等外部评分使用不同字段和标签，不合并成一个不透明分数。

### 5. 餐厅发现、消歧与建档

- `CatalogIntakeSession` 接受餐厅名加可选街区／地址，或单独的完整地址；服务以该线索查重并查询受控来源，补齐可许可的分店名称、精确地址、坐标、外部评分／评论数、来源与核验时间。“收录／加入／保存这家店”等自然语言可以提出 intake intent，但不能跳过候选选择、预览或确认；字段不可合法取得时显示 unknown，不得猜测或把模型文字当成事实。
- 只有 `provider namespace + stable place ID`，或 provider contract 明确保证一店一 URL 的 `provider namespace + canonical source URL`，才是可自动复用现有 item 的强同一性键；强键在 D1 中受唯一约束。
- 规范名称相同、规范地址相同、坐标接近、跨 provider 匹配或 provider ID 变化都只能产生“疑似重复”候选，绝不自动合并。预览并列显示新候选与最多三个已有 item 的分店证据，由 owner 明确选择“使用已有”或“仍建新档”；坐标只用于排序和展示，不作为身份键。
- 未命中强键时，由服务端受控的 `PlaceDiscoveryProvider` 搜索候选。OpenClaw／DeepSeek 不直接浏览任意 URL，也不把模型生成的地址、坐标或评分当成事实；provider 的字段映射、超时和错误脱敏由 Atlas adapter 控制。
- PlaceDiscoveryProvider 与 EntryAccessProvider 共享统一 provider egress gate：只能主动访问已登记的 HTTPS origin；每次 DNS 解析及每一跳 redirect 都重新校验，拒绝 URL credentials、非 HTTPS、loopback、link-local、RFC1918、CGNAT、ULA、metadata 与解析后私网地址。用户／模型／provider 返回的其他 URL 只能在规范化和公共地址校验后作为数据展示，不能触发二次抓取。
- 对应 provider 启用前必须分别保存版本化 credential scope、origin allowlist、字段级“允许读取／瞬时展示／持久化”清单与使用条款核对证据；未登记字段不得进入 evidence snapshot、数据库、prompt 或回执。EntryAccess 只长期保留两个 assertion 的状态、来源 URL、checkedAt、warning 和可选等待分钟数作为最小审计证据，供应商正文与其他动态字段不得持久化。
- 零候选时要求用户补充街区／地址；一个候选时进入预览；多个合理候选时最多列出三个，至少显示名称、分店／区域与地址，等待用户选择。用户选择绑定 candidate ID，不能只靠候选序号在后续请求重新搜索。
- 预览绑定 immutable evidence snapshot、evidence digest、preview version 与当时 catalog revision，并至少显示名称、类型、区域、规范地址、地图深链、外部评分、评分平台、评论数（若有）、来源链接、各事实核验时间、预约快照、疑似重复项及未知字段。
- 确认时必须现场重读 provider 并比较 evidence digest；还要在同一 publish transaction 内重查强同一性键和 catalog revision。来源、revision 或强键占用发生变化时返回 `conflict` 与新预览，旧确认不得自动套用。
- 外部评分只能写入带来源 URL 与 `checkedAt` 的平台 snapshot（现模型可承载食べログ）；不得写入 `PlaceAssessment.overallRating`、个人摘要、到访状态或模型推断的综合分。
- `verified` 要求同一允许来源记录同时支持稳定分店 identity、规范名称、精确地址与坐标，所有持久字段都有 provenance／checkedAt，且关键来源无冲突；任一条件缺失或冲突都 abstain，并把最终状态固定为 `needs_review`。
- 对外只暴露窄操作 `catalog.intake.discover` 与 `catalog.intake.confirm`；底层 `catalog.save_discovered`、通用 update 和验证晋升不进入 Agent tool manifest。`catalog.intake.confirm` 用一个稳定 mutation/item ID，在同一 D1 transaction 内完成 needs_review intake、条件 verified 晋升、强键唯一检查和最终 receipt。
- Catalog confirm 对外只有 `committed_verified | committed_needs_review | conflict | failed_no_write`；前两者都是有意且完整的 committed 终态。事务失败不留下可见 item 或 receipt；响应丢失后同一 mutation ID 重放事务内保存的同一 receipt，不得用两次普通 operation 串联冒充原子建档。
- 复用已有 item、`committed_verified` 和 `committed_needs_review` 三种分支都允许开始 Visit；needs_review item 可在 owner 的完整 Catalog／地图深链中查看并带“待核验”标记，但不进入默认 verified-only nearby。
- 若 Catalog 已 committed 而 VisitCaptureSession 启动失败，回复必须保留 Catalog receipt、item ID 和 verification status，并只提供“重试开始记录”；重试直接引用该 item ID，不重新 discovery 或建档。Catalog 与 Visit 始终使用两个独立 mutation／receipt。
- 自动抓取任意网页、绕过来源条款、猜测缺失评分、按弱证据静默合并分店或无确认自动建档均失败关闭。

### 6. VisitCaptureSession

- 会话以认证 owner、channel account、conversation 和 session ID 定位，并绑定一个明确 Atlas item；不得用最近一次 Visit 或未受约束的聊天历史推断归属。
- 状态至少覆盖 `resolving_place → capturing → paused → ready_to_commit → committing → committed`，以及 `cancelled | expired | recovery_required`。
- 同一 conversation 默认只有一个 active Visit capture。开始另一个地点时必须先要求提交、取消或明确切换，不得静默把原草稿改绑新地点。
- 显式命令至少支持“开始记录 <地点>”“查看记录”“完成记录”“继续补充”“确认保存”“取消记录”。自然语言只能提出 intent/字段候选，确定性 coordinator 决定状态转移。
- 文字按渠道稳定 message ID 和单调递增 conversation sequence 保存为草稿片段；模型可提出日期、评分、整体笔记和图片说明候选，但冲突评分、地点变更或说明归属不明时必须询问。
- 图片先成为有 24 小时生命周期的 staged attachment，而不是 `VisitMedia`。图片说明优先绑定微信 reply-to-image；“第 N 张”次之；“上一张”仅在唯一无歧义时使用。
- 仅被当前状态接受的控制命令或内容更新 `lastAcceptedActivityAt`；重复、冲突、乱序和无关消息不刷新时钟。达到 30 分钟边界时先转为 paused，再处理消息并询问是否继续；达到 24 小时边界时 expiration 优先，不再接受恢复。
- 24 小时从最后一次被接受的活动起算；expired 后清理未提交草稿／附件，不创建 Visit。暂停本身不延长生命周期。
- “完成记录”只生成预览；“确认保存”使用稳定 mutation ID 提交。没有评分且没有非空笔记时保持现有 Visit 不变量，提示用户补充，不在本特性开放纯照片 Visit。
- capture 对外提交状态为 `recovery_required | committed | abandoned`，其中只有 `committed | abandoned` 是终态，且任何状态都不返回“部分成功”。确认保存后，Visit、PlaceAssessment 和 VisitMedia 元数据先写入 regular map/journal 查询不可见的 staged 区域，图片对象也只进入 staged R2 前缀。
- 只有一次 D1 原子 publish 能让 Visit 与整组媒体同时对普通读取可见；publish 前任何失败都返回同一 mutation ID 的 `recovery_required` pending receipt。重试复用相同 Visit／media ID，只继续缺失步骤；响应丢失后重放同一最终 receipt。
- owner 可对 `recovery_required` 选择重试或放弃；放弃会清理 staged 数据。恢复窗口超过 24 小时则自动变为 `abandoned`，孤儿保持不可见并由 reconciliation 清理。只有原子 publish 成功后才能签发 `committed` receipt。
- committed 后普通读取必须一次看到完整 Visit 与全部已确认媒体；任何故障注入路径都不得出现重复 VisitMedia、半条 Visit 或部分图片可见。
- committed 后的迟到图片不自动关联。只有用户明确引用保存回执并要求追加时，才能建立新的附件追加草稿，并再次预览／确认。

### 7. 幂等、回执与保留

- `ChannelAdapter` 必须提供能跨供应商重投保持稳定的 event ID、单调递增 conversation sequence、`occurredAt` 与 `receivedAt`，并以 actor + channel + conversation + event ID 保存 canonical payload digest；相同标识和相同 digest 重放已知结果，相同标识但不同 digest 返回 conflict。
- 若当前腾讯微信插件不能证明重投时 event ID 稳定，write gate 必须失败关闭；只读 nearby 可继续，但不得暴露 catalog intake 或 capture mutation。
- coordinator 按 sequence 确定顺序：已处理 sequence 的相同事件只重放结果，同 sequence 不同 payload 冲突；未处理事件按以下状态表产生唯一外部结果：
  - `resolving_place`：只有能回答当前地点澄清的文字被接受；其他文字返回 `resolution_expected`，图片返回 `place_not_resolved`，均不入草稿。
  - `capturing`：尚未处理的迟到文字／图片按 sequence 插入草稿并返回更新后的 draft version。
  - `paused`：内容返回 `resume_required` 且不入草稿；用户明确“继续补充”后须重发内容。
  - `ready_to_commit`：新文字／图片返回 `resume_required` 且不入草稿；用户明确 `record resume` 后才能继续补充，旧 preview version 随成功恢复失效。
  - `committing | recovery_required`：返回 `capture_locked`，不修改已绑定 mutation payload。
  - `committed`：普通内容返回 `capture_closed`；只有明确引用 receipt 的追加命令创建新的 append capture，随后重新预览／确认。
  - `cancelled | expired | abandoned`：新的普通内容统一返回 `capture_closed` 且不恢复旧 session；新的显式“开始记录”可创建全新 session。已处理过的旧 event 重投仍按 event ID 重放其原结果。
- 写入以稳定 mutation ID 绑定完整 payload 和最终 receipt；receipt 至少包含 operation、目标公开 ID、完成状态、已完成媒体数和可安全展示的重试信息。
- 单个 capture 最多接受 100 段文字、20,000 个 Unicode 字符、24 张图片、每张 8 MB、合计 128 MB，HTTP 每批仍最多 4 张；超限事件整体拒绝且不破坏已有草稿。
- 临时附件／草稿最多保留 24 小时；capture 关闭后的原始聊天正文最多保留 7 天；结构化审计遵守 180 天既定策略。
- 图片二进制不进入模型 prompt 或普通日志。需要语义抽取时只向模型提供被允许的文字与最小附件元数据，并继续遵守既定云模型处理边界。

### 8. 阶段门

- Read-only gate：隔离 Cloudflare fixture 上完成 owner 微信 DM → OpenClaw → Agent service → nearby → 微信回复；规范 `/jpmap` 在真实 AWS 版本＋腾讯微信路径保存版本／commit／配置／trace 并证明模型调用为零；无 write/destructive 工具可见，第二账号／群聊／伪造凭证拒绝，日志检查通过。bare alias 只有通过独立 capability probe 才启用，否则保持未注册。
- Write gate：本特性实现并验证 `PreModelIngressRouter` 真实微信探针，以及 APP-02 中 Catalog／Visit／Media 写入所需的 message/mutation 幂等、conflict、receipt 与恢复子集、AGENT-02 中 Atlas Agent 服务所需的鉴权、scope、owner allowlist 和审计子集后，才可启用 bare alias、多消息 capture 与 catalog intake／capture write tools；不能据此将 APP-02、AGENT-02 整体标记完成。
- Trash、永久删除及其他 destructive 操作仍留在后续特性，不能通过本阶段工具清单或通用 OpenClaw 能力绕过。
- Real-data gate：假数据读写 E2E、重启恢复、弱网／重复投递、第二账号拒绝、二维码重连和独立安全评审通过；轮换聊天中已暴露的 DeepSeek key；feature 003/T-14 的生产数据安全门仍独立生效。

## Testing Decisions

优先使用五个高层测试缝，并让供应商 adapter 由 contract tests 约束：

1. `ProjectCommandRouter.dispatch(envelope)`：验证规范 slash 命令、capability gate 开／关矩阵、无斜杠严格别名、闭合语法、active capture 内容归属、跨项目隔离和受保证路径的模型零参与。
2. `AgentServiceGateway.handle(request)`：验证认证、scope、schema、错误映射、tool manifest、message/mutation 幂等与 receipt。
3. `NearbyRecommendation.execute(query)`：注入假的 LocationResolver、RouteProvider、EntryAccessProvider、clock 和 CatalogRead，验证地址歧义、步行层、扩展层、未到访优先、评分分离、walk-in／排队未知语义、过期 warning 和稳定排序。
4. `CatalogIntakeCoordinator.handle(channelEvent)`：注入假的 CatalogRead、PlaceDiscoveryProvider、CatalogWrite、clock 和 evidence store，验证查重、零／一／多候选、来源映射、preview version、确认与 verification status。
5. `ConversationCoordinator.handle(channelEvent)`：注入假的 AtlasApplication、草稿／attachment store 和 clock，验证完整状态机、重复／乱序事件、预览确认及重启恢复。

测试只断言外部可观察行为，不以实现类名、SQL 文本或 prompt 措辞代替产品结果。至少覆盖：

- 位置：空文字、未知地址、同名街区、唯一地址、`银座`／`銀座`／`ginza` 三语等价校准、模型伪造坐标、resolver 失败、路线缺失／过期。
- 路由：用 capability gate × 明确输入→结果表覆盖小写规范命令、大小写错误、空白、双引号／转义、未知／重复 flag、空值／未闭合引号、缺参／尾随参数、平台保留 slash、未知 slash、bare 相似前缀、active／paused／ready／无 capture 和其他项目命令；规范 `/jpmap` 及 gate 开启时被 ingress claim 的路径模型调用为零，gate 关闭时 bare 输入可进入普通模型但项目工具调用与状态变化为零；项目凭证／状态不可串用。
- Nearby：15 分钟边界、2 公里边界、门到门恰好 20:00 通过／20:01 拒绝、无换乘／有换乘、无首层结果才扩展、verified-only、food 条件、显式排序覆盖、个人评分仅在 Effective Visited State 为真时可见；walk-in 与 queue 不同来源、一项失败另一项成功、明确无需排队、排队但时长未知／已知、只有 reservable、过期排队和来源失败分别映射到正确 assertion。
- Catalog intake：仅名称、名称＋街区、仅完整地址、零／一／三个以上候选、同楼不同店、同名不同分店、同址多 POI、provider ID 变化、强键自动复用、弱键只提示不合并、owner 仍建新档、并发双确认、catalog revision／provider evidence 变化使旧预览 conflict、确认／取消、证据完整 verified、证据不足 needs_review、四种提交结果、response-lost 回执重放及三种建档分支转 Visit。
- 安全：无凭证、错误／过期凭证、错误 scope、第二微信账号、群聊、伪造 conversation/re reply、prompt injection、伪造来源／评分、URL credential、redirect 逐跳、DNS rebinding、loopback／link-local／私网／metadata 地址、未登记域名／字段／条款、供应商正文脱敏、EntryAccess 与 discovery credential 隔离、未暴露底层 Catalog 写／删除／maintenance 工具；PlaceDiscoveryProvider 与 EntryAccessProvider 各自运行完整 egress／字段条款 contract suite。
- Capture：显式／自然语言开始、零／一／多地点、多段文字顺序、评分冲突、多图、reply caption、查看、暂停、恢复、取消、过期、30 分钟与 24 小时精确边界、无关／重复消息不续期、各终态新旧事件、完成后继续补充、确认保存、纯照片提交拒绝。
- 幂等：同 event ID 同 payload 在 active／terminal 状态均重放原结果；同 ID 不同 payload conflict；缺失稳定 event ID 时 write gate 失败；Catalog／Visit／Media 的每个 staging／publish 边界及 response-lost 故障注入；重启后 receipt replay；任何路径重复地点、重复写入、丢失写入和半可见结果均为零。
- 媒体：允许格式、签名、8 MB 单张边界、每批最多 4 张、24 张／128 MB 会话边界、超限事件原子拒绝、第二／第三批失败恢复、staged attachment 清理、R2/D1 orphan 检查及日志无二进制。
- 真实 E2E：AWS OpenClaw mocked tool suite → 隔离 Cloudflare D1/R2 → owner 微信 DM；先证明规范 `/jpmap` 不经模型路由，并用 provider-call counter 决定 bare `jpmap` alias 是否可启用，保存版本／commit／配置／trace；再由真实插件覆盖仅名称建档、强／弱重复、同名分店消歧、verified／needs_review 及其地图可见性、Catalog committed 后 Visit start 失败与仅重试 Visit、nearby walk-in／排队显示、完整 capture、稳定 event ID 证明、第二账号 deny、gateway/API 重启、二维码失效与重连。
- 弱网：在 800 ms 往返延迟和 10% 可重试请求失败注入下，5 秒内返回 pending 提示、30 秒内完成正常 committed 回执、需要恢复的提交 60 秒内收敛，且重复、丢失和半可见结果均为零。
- Soak：连续七天运行固定的 catalog intake／nearby／capture 脚本，合法脚本成功率至少 95%，重复地点、重复写入、丢失写入、半可见结果和未授权成功均为零，write receipt p95 不超过 30 秒，服务重启后自动恢复不超过 5 分钟，不发生计划外人工数据修复；二维码重新授权单独记录，不计入自动恢复。基础设施、模型、地点发现和路线服务的月度 PoC run-rate 合计不超过 60 美元，并完成一次不依赖开发终端的纯手机旅行演练。
- 来源校准：每次 PlaceDiscoveryProvider／字段映射版本变更都运行固定标注集，自动确认精确分店 precision 至少 90%、Top-3 recall 至少 95%、字段 provenance 完整率 100%；冲突／缺项必须计入 abstain，不得以 owner 后续纠正掩盖自动确认错误。

## Out of Scope

- 微信原生位置卡片、实时／后台定位、一次性定位网页及地图分享短链接解析。
- 让任一 OpenClaw 项目 route 直接访问 GitHub 仓库、D1、R2、Cloudflare 管理 API、shell、maintenance 或 reset；gym、Bobo Monitor 等其他项目的内部能力设计不属于本特性。
- 公开多用户、朋友只读分享、群聊协作及 owner 之外的长期权限模型。
- 破坏性操作、30 天 Trash 的完整实现、预约／付款／取消或对外发送消息。
- 自动识别照片内容、把图片二进制发送给 DeepSeek、语音转写和创作者来源采集。
- 修改腾讯微信插件协议或把 OpenClaw 固化进 Product Core。
- 执行 feature 003 的生产 snapshot/reset 或 `001/T-14`。

## Further Notes

- 本规格扩展的是现有 Agent-ready Application Core，不重新定义 AtlasItem、PlaceAssessment、Visit、VisitMedia 或 Effective Visited State。
- 精确 place discovery／外部评分／geocoding／routing／transit 供应商、Cloudflare deployment identity、服务凭证协议和 staged media 物理布局属于 `hf-to-architecture` 选型；供应商选型必须核对合法字段、来源条款、成本与日本覆盖，但不得降低本规格的证据、权限和失败关闭要求。
- 已确认默认值为：步行硬上限 15 分钟、无需换乘电车门到门 20 分钟；capture 配额为 100 段／20,000 字符／24 图／128 MB；七天脚本成功率至少 95%，月度 PoC run-rate 不超过 60 美元。
- 本特性只交付 APP-02 的 Catalog／Visit／Media 子集和 AGENT-02 的 Atlas 服务子集；Trash 与其他 destructive 项仍由后续特性负责。
- 用户确认: 2026-09-13（含 ProjectCommandRouter、walk-in/排队核验、20 分钟直达上限及全部默认值）
