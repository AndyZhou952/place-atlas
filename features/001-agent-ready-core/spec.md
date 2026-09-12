# 001 — Agent-ready Application Core

## Problem Statement

Japan Atlas 的地图、个人状态、Visit、媒体与导入队列已经可以持久使用，但业务行为目前分散在 React ViewModel、HTTP route、`atlas-store`、`media-store` 和页面内 WebMCP 工具中。Web 与 WebMCP 依赖各自的调用路径和页面状态；未来 Agent、采集器或第二种渠道若直接复用这些实现，会被 React、Next、D1/R2 或浏览器生命周期绑定，并容易产生不同入口语义漂移。

本特性需要在不改变现有用户体验和数据含义的前提下，建立框架无关、可由测试直接驱动的 Application Operations。它是后续可靠写入、服务鉴权、Agent 工具和微信接入的前置接缝，不是这些能力本身。

## Solution

建立框架无关的 `AtlasApplication` 模块，作为地点、个人状态、Visit、媒体、ImportJob、search 与 nearby 的唯一应用操作入口。业务不变量、跨记录编排和结果语义从 delivery 与存储实现中移入该模块；D1/R2、HTTP 和 WebMCP 改为其 adapter。Web ViewModel 继续负责乐观更新与失败回滚，但不再定义服务端业务规则。

迁移以当前生产行为为兼容基线：页面布局、正常操作流程、现有 HTTP 路径/方法和既有 WebMCP 工具名称不发生破坏性变化，既有 Atlas 条目及其来源事实继续可读写。按用户确认，旧 PlaceAssessment 中的喜欢、人工到访、个人评分与摘要只是前端测试状态，不要求保留；另有两项明确的旧缺陷修正：按 D-009 统一 `有效行った = 存在 Visit OR manualVisited`，以及 `/api/nearby` 缺少 `lat` 或 `lon` 时返回 HTTP 400 `invalid_input`，不再把缺失值解释为坐标 `0`。

30 天可恢复删除、完整 mutation 幂等、鉴权、审计、媒体加固及新的 Agent 功能不在本特性直接实现，adapter 不得把它们宣称为已支持。

## User Stories

1. 作为 Japan Atlas 用户，我希望重构后地图、Journal、喜欢、评分、到访、图片和 Inbox 的日常操作保持原有体验，并保留既有地点；已明确授权重置的旧个人测试状态除外。
2. 作为用户，我希望任何入口都以 `存在 Visit OR manualVisited` 判断 `行った`，从而真实 Visit 不会被一次状态切换隐藏。
3. 作为用户，我希望删除最后一次 Visit 后，只有我此前明确设置过 `manualVisited` 的地点仍显示 `行った`，从而实际记录和人工标记具有一致含义。
4. 作为用户，我希望现有多语言/标签搜索继续得到相同结果，从而重构不降低查找地点的能力。
5. 作为用户，我希望 HTTP nearby 继续只按距离返回可信地点，而浏览器 Agent 暂时保持当前页面集合/UI 语义，并且两者都从 AtlasApplication 读取数据，从而本次重构不静默改变任一入口结果。
6. 作为用户，我希望迁移后新设置的地点标题、描述、个人状态、喜欢和总体评分可以保存并在刷新后恢复，从而地图整理流程继续可用。
7. 作为用户，我希望可以重复记录、纠正和删除 Visit，并保持总体评分与 Visit 分离，从而长期评价不会被每次行程复制。
8. 作为用户，我希望图片仍明确归属 Visit，并可批量追加、读取、修改说明和删除，从而现有相册数据与顺序保持可用。
9. 作为用户，我希望仍可创建、查看和删除 ImportJob，并看到当前的排队状态，从而未来 collector 尚未接入时请求也不会丢失。
10. 作为浏览器 Agent 使用者，我希望既有 WebMCP 工具通过同一 AtlasApplication 执行，从而页面操作和工具操作不再各自定义业务规则。
11. 作为后续渠道开发者，我希望无需导入 React、Next、WebMCP、D1 或 R2 就能调用和测试全部既有应用操作，从而可以安全开发新的 adapter。
12. 作为维护者，我希望 HTTP 与 WebMCP 只负责协议校验和结果映射，从而修复业务缺陷时不必修改多个入口。

## Implementation Decisions

### 1. 公共测试缝

- `AtlasApplication` 是本特性的主公共 interface，也是 Application Operations 的唯一跨模块协调者。
- 调用方只需了解操作输入、结果、业务不变量、错误类别和必要的顺序约束；它不暴露 SQL、D1/R2 binding、React state、HTTP 对象、浏览器 `File/FormData` 或 WebMCP 类型。
- Product Core 只依赖由调用方注入的持久化、媒体、时钟与 ID ports；生产使用 D1/R2 adapters，测试使用内存 adapters。
- Product Core 不导入 delivery、UI 或供应商 SDK；HTTP、WebMCP 和存储 adapter 均依赖核心 interface，依赖图不得成环。
- 本切片为未来 invocation/mutation context 保留单一组合接缝，但不实现 credential 校验、逐操作授权、审计日志或通用 receipt。

### 2. 行为保持范围

| 操作组 | 本次必须经 AtlasApplication 提供的现有行为 |
|---|---|
| Atlas 条目 | 列出合并后的静态可信目录与动态条目；读取单项；保存只能进入 `needs_review` 的采集结果；保存标题/描述/个人状态覆盖；执行现有删除与 tombstone 语义 |
| PlaceAssessment | 修改可空总体评分、喜欢、人工到访状态和既有长期摘要；列表/单项结果继续合并评分、喜欢与有效到访状态；评分保持 0–5 且归一到一位小数 |
| Visit | 列出、创建、修改和删除；创建至少含评分或笔记；评分更新 PlaceAssessment 而不是成为 Visit 字段；保留调用方提供 Visit ID 的现有特征化重投行为 |
| VisitMedia | 按 Visit/地点列出、读取内容、附加、修改说明和删除；保持现有类型、签名、8 MB、说明归一化、hash 与显示顺序语义 |
| ImportJob | 列出、排队和删除；保持平台推断、初始 `queued` 状态和“等待 collector”含义，不推进 worker 状态 |
| Search | 保持 NFKC/大小写/标点归一、多词 AND、字段/标签部分匹配与现有 bigram 宽容匹配；默认只形成可信地图可见集合 |
| Nearby | 校验经纬度和 limit 并按现有球面距离升序：HTTP 保持 1–20 limit 与 `verified` 集合；WebMCP `find_nearby_atlas_items` 暂时保持当前页面集合/UI 语义但数据读取必须经过 AtlasApplication；不增加半径、营业、预约、喜欢或到访筛选 |

网页一次选择 24 张、Browser adapter 拆批以及 HTTP adapter 每请求最多 4 张均是 delivery 兼容行为；核心媒体操作只接受框架无关的字节与元数据表示，不拥有浏览器选择或 HTTP 请求上限。

### 3. `行った` 规范化

- `manualVisited` 表达用户独立于 Visit 的人工标记；`personalState: visited` 不参与有效到访计算，但该枚举值在兼容期仍可读写。
- 创建 Visit 使有效状态为真，但不得暗中把 `manualVisited` 改为真。
- 有任意 Visit 时，把人工标记设为 false 后 mutation 仍返回有效状态 true；无 Visit 时返回人工标记本身。
- 删除一条 Visit 后重新计算有效状态；删除最后一条时，仅已有 `manualVisited=true` 可保留 true。
- 数据变更采用封闭白名单：只允许把 PlaceAssessment 中的 `isFavorite`、旧 `hasVisited`／人工到访位、个人评分和摘要四类测试字段重置为空／false，不迁移为新个人状态。
- 白名单之外的所有表、记录、字段与 R2 对象必须保持逐项不变，包括 Atlas 条目及 override（含 `personalState`）、来源／外部评分／预约／活动事实、Visit、VisitMedia、ImportJob、tombstone、旧 `journal_entries` 和媒体对象。
- 升级验收必须对迁移前后快照证明白名单外数据不变、四类测试字段清空、由既有 Visit 推导出的有效 `行った` 仍为 true，且重复执行 migration 结果不变；只能新增 migration，不能修改已部署文件。

### 4. 公共错误集合

`AtlasApplication` 只公开以下闭合、框架无关的错误类别：

| 类别 | 判定条件 |
|---|---|
| `invalid_input` | 调用输入缺少必需值、类型/范围/格式不合法，或媒体不满足本切片既有类型、签名、大小与说明约束 |
| `not_found` | 操作明确引用的 Atlas 条目、Visit、VisitMedia 或 ImportJob 在当前可见数据中不存在或已被 tombstone 排除 |
| `dependency_failure` | 已识别的持久化或对象存储 port 调用失败、超时或不可用，导致操作无法按既有语义完成 |
| `unexpected_failure` | 不属于前三类的内部异常或不变量破坏；仅作为不可预期失败的安全兜底 |

本切片没有 `conflict`、`unauthorized`、`forbidden` 或审计相关公共错误；不得用这些类别暗示 APP-02/AGENT-02 已实现。HTTP 与 WebMCP 只映射上述类别，不改变业务含义；对外错误不得包含 SQL、binding、bucket、堆栈或供应商异常正文。

### 5. Adapter 兼容

- 现有 `/api/items`、`/api/items/:id`、`/api/items/:id/personal`、`/api/journal`、`/api/journal/:id`、`/api/media`、`/api/media/:id`、`/api/media/:id/content`、`/api/inbox`、`/api/inbox/:id`、`/api/nearby` 与 capabilities 路径及 HTTP 方法保持可用。
- 正常成功、无效输入、未找到和意外失败仍映射为现有 HTTP 类别；正文可以统一生成，但已有客户端依赖的 JSON 形状与媒体 URL 不得破坏。
- 现有 WebMCP 工具名称和输入 schema 保持兼容；`focus_atlas_item` 可以继续作为纯 UI 意图，持久或查询工具必须通过 AtlasApplication adapter，不得直接读取 ViewModel 缓存作为事实源。
- operation catalog 只有一个定义来源；capabilities 与 WebMCP 从该来源映射各自可表达的操作，不能继续手工维护相互矛盾的清单。
- route 只完成协议解析、运行时校验、调用和响应映射；不得直接查询 D1/R2 或重新实现有效到访、评分、搜索和 nearby 规则。

### 6. 已知兼容例外与债务

- D-009 的有效到访状态是本次必须达到的目标不变量，不按旧的短暂错误 response 保持。
- 旧 `/api/nearby` 会因 `Number(null)` 把缺失的 `lat` 或 `lon` 意外解释为 `0`；用户于 2026-09-12 确认这是缺陷。本特性将缺失、非数值或越界坐标统一映射为 HTTP 400 `invalid_input`，不保留该旧行为。
- 除上述缺失坐标输入修复外，nearby 的集合语义不变：HTTP `/api/nearby` 保持只含 `verified`；WebMCP `find_nearby_atlas_items` 暂时保持当前页面集合/UI 语义，但改由 AtlasApplication 提供该集合与距离结果。两者的可信集合统一另立后续规格，不在本次重构中决定。
- Visit update 保持当前兼容行为：日期必填，可修改/清空笔记，可选择更新或清除地点总体评分。本特性不额外禁止一个既有 Visit 最终同时没有笔记和评分；该问题不得被解释为支持“纯照片 Visit”。
- 现有删除仍是不可恢复删除/清理加条目 tombstone；本特性不新增 Trash Entry、restore、30 天清理任务或软删除 UI，且返回信息不得暗示可恢复。D-017 将由后续独立特性落实。
- 相同 caller-supplied Visit ID 重投时保持现状：不新增第二条 Visit，但仍按本次请求更新请求所指地点的 PlaceAssessment，并返回由本次请求构造的 Visit/地点视图，而不是读取并重放旧 Visit 结果；请求的地点、日期、笔记或评分与旧记录不同也不产生 `conflict`。不得在本切片提前实现 payload conflict 或 result replay。
- 除上述 Visit ID 特征化行为外，本特性不承诺媒体/ImportJob 幂等或跨操作幂等。APP-02 必须在任何外部消息渠道写入前补齐。
- Sites owner-only 继续是当前网页外壳，不等同服务端 Agent 鉴权。本特性不发放 Bot credential，不实现 scoped auth、签名、逐工具权限或结构化审计；AGENT-02 前必须另立安全规格。
- 媒体保持当前校验与补偿，不新增可信像素尺寸、缩略图、失败批次自动重试、并发顺序治理或 D1↔R2 孤儿清理；这些继续由 MEDIA-02/#4 跟踪。

### 7. 迁移策略

- 使用行为保持式垂直迁移：先以 characterization tests 锁定一个操作组，再把其业务编排移入 AtlasApplication，最后将旧直连路径替换为 adapter；不在旧实现外永久叠加第二套业务层。
- 每个操作组切换后，HTTP、WebMCP 和 Web UI 必须读取同一持久结果；禁止双写、影子数据库和长期 feature-specific 状态复制。
- 静态可信目录、D1 数据、R2 object key 和现有公开标识继续兼容；若 D-009 需要新 migration，只能新增 migration 并提供既有数据升级验证。
- UI 结构、文案样式和地图引擎不因本特性改变；ViewModel 只调整为调用新的 Browser/Application adapter，并保留现有乐观更新与失败回滚。

## Testing Decisions

### 主测试缝

- 主要验收通过框架无关 `AtlasApplication` 的公共行为完成；测试不构造 Request/Response、React、WebMCP、D1 或 R2。
- 同一 Application contract suite 至少运行于内存 adapters；D1/R2 生产 adapters 使用较小的 integration suite 证明契约映射、事务/补偿和既有数据兼容。
- 每个迁移操作先写失败的 characterization/contract test，再迁移实现，通过后重构；现有纯函数和 SQL 预算测试继续保留。

### 必测公共行为

1. Atlas 条目的静态/动态合并、override、assessment、tombstone 和 malformed 动态 payload 容错。
2. 评分 0、5、任意小数归一化、favorite 独立性，以及迁移后新写入状态的持久化。
3. 迁移 fixture 对所有 D1 表与 R2 object-key manifest 做前后快照，只允许 PlaceAssessment 的四类白名单字段变化；随后验证由既有 Visit 推导的有效状态、`manualVisited × Visit 数量` 真值表及读写一致性。
4. Visit 创建最低内容、修改/清空行为、评分副作用和删除对账；另以同 ID/同 payload 与同 ID/不同地点或评分重投分别证明：Visit 行数不增加、PlaceAssessment 仍按当前请求更新、返回当前请求视图且不产生 conflict/result replay。
5. 媒体类型/签名/大小/说明、归属、顺序、内容读取及现有失败补偿；网页分批不是核心测试的一部分。
6. ImportJob 平台推断、初始状态、排序和删除。
7. 搜索归一化、多词 AND、标签/多语言/模糊匹配与空查询。
8. nearby 坐标边界、limit、稳定距离顺序与空集合；HTTP profile 只含 verified，WebMCP profile 保持当前页面集合，两者均从 AtlasApplication 读取。
9. 四类公共错误的判定与穷尽映射；storage/error ports 失败不得泄露供应商异常或产生未经现有语义允许的额外写入，并证明本切片不返回 conflict/unauthorized 等范围外类别。
10. 静态依赖检查保证 Product Core 不导入 React、Next、routes、D1/R2 或 WebMCP，并保证模块依赖无环。

### Adapter 测试

- HTTP 只选每类操作的代表路径，验证输入解析、关键状态码、JSON/二进制映射和错误映射；不在 route tests 重复全部业务组合。
- WebMCP 只验证 operation catalog 映射、现有工具名/schema、破坏性 annotation，以及工具调用被正确转交给 AtlasApplication；不复制核心行为测试。
- 保留一个 Web 冒烟/E2E 路径，覆盖加载地图数据、切换喜欢/到访、创建 Visit 与附加图片，证明 MVVM 乐观状态最终与持久结果收敛。
- 不以 mock 私有实现、SQL 调用顺序或内部函数数量作为主验收；性能预算中既有 Visit D1 往返测试可作为 adapter 约束继续存在。

## Out of Scope

- 推荐排序、解释、营业/预约可行性筛选和新的自然语言查询。
- Evidence Manifest pipeline、精确地点/分店解析、`needs_review → verified` identity confirmation 和人工审核界面。
- VisitCaptureSession、聊天附件关联、纯照片 Visit、回复图片说明和微信/OpenClaw/Hermes/Pi adapter。
- 完整 mutation/message 幂等、payload conflict、结果重放、通用 receipt、授权、签名、审计和 Bot credential。
- 30 天回收站、恢复、到期清理、备份淘汰和相关 UI。
- 媒体尺寸解码、缩略图、转码、失败批次恢复、并发显示顺序修复和孤儿对账。
- 新地图引擎、托管性能治理、离线队列、弱网同步、24/7 provider/region 选择和七天 soak。
- View 视觉重构、公开多用户能力、社交功能、预约/付款/取消或对外消息。

## Further Notes

- 该特性完成的含义是“现有产品行为已有框架无关且经过测试的唯一应用入口”，不是“Agent 已可安全部署”。
- 后续优先顺序保持为：APP-02 写入可靠性与删除策略、AGENT-02 服务安全，再进入 AgentRuntime、采集器和微信适配。
- 任何实现中发现的新行为差异必须先作为 compatibility finding 记录并回到本规格确认；不得在重构中静默选择。
- 用户确认: 2026-09-12
