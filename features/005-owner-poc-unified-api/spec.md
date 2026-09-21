# 规格 — Owner PoC 统一应用操作

- 日期：2026-09-21
- 状态：confirmed；第 3 轮独立评审通过，进入 implement
- 用户确认：2026-09-21

## Problem Statement

用户现在能打开 Japan Atlas 地图，但收藏、去过、评分等状态无法保存，因为公开页面与线上只读 Agent fixture 使用了不匹配的数据库结构。Web 和微信也没有完整地执行同一组业务操作：浏览器拥有较完整的个人状态接口，微信目前只开放了独立的 Nearby 入口。

用户需要一个可日常试用的个人 PoC：网页可公开浏览，Owner 登录后可以使用原有控件修改；微信通过 `/jpmap` 访问同一个目录、个人状态和 Nearby 规则。模糊语义可由 DeepSeek 辅助理解，但确定性操作、权限、路线事实和写入必须由 Atlas 控制。

## Solution

建立新的蓝绿 `owner-poc` Cloudflare 环境，把完整 Atlas schema、Agent gateway tables 与 provider usage ledger 放入一个隔离 D1。`atlas_items` 是规范地点目录，`place_assessments`、`visits` 与 `visit_media` 是规范个人事实；Web 和 Agent 最终都调用同一个 `AtlasApplication` operation，只在认证适配器和输出呈现上不同。

网页增加一个与现有暖色编辑风一致的简单 Owner Login。页面与控件布局保持不变；未登录用户仍能浏览和点击现有控件，但任何写请求会要求登录或稳定失败，登录成功后原控件立即可用。浏览器写入用签名 Cookie 鉴权，Agent 请求继续使用 HMAC、owner/channel/conversation、scope 和幂等回执。

真实 Nearby 通过独立只读 Google Route Sidecar 使用 Geocoding 与 walking Route Matrix。Sidecar 只持 Google key，不绑定 Owner 密码、owner D1 或 R2；owner-poc 只通过窄结构化 service binding 发送本次位置线索与候选坐标。调用前由 owner-poc 的分 SKU ledger 预留额度，并与 Google Cloud quota 构成双门。DeepSeek 可以把模糊文字翻译为经过 schema 校验的 proposal，但不能提供坐标、路线或第三方评分事实。Foursquare 与 Transit Routes 暂不进入运行链路。

## User Stories

1. 作为访客，我希望无需登录即可浏览地图和地点，这样我可以快速查看 PoC。
2. 作为 Owner，我希望输入自己设置的密码后继续使用现有控件，这样不需要学习新的编辑模式。
3. 作为 Owner，我希望收藏、去过、评分和总体评论能保存并在刷新后恢复。
4. 作为 Owner，我希望未登录用户即使直接调用写接口也无法改变数据。
5. 作为 Owner，我希望网页和微信看到同一地点、到访状态和个人评分，避免两个系统越用越不一致。
6. 作为 Owner，我希望从网页或微信查询同一位置时使用同一 Nearby 规则和路线事实，只是展示形式适合各自渠道。
7. 作为 Owner，我希望先用精确 `/jpmap` 命令获得稳定结果，模型变化不会改变操作选择。
8. 作为 Owner，我希望以后使用自然语言时，DeepSeek 只负责整理意图，有歧义仍让我确认。
9. 作为 Owner，我希望路线 API 超出免费预算前自动停止，避免个人 PoC 产生意外费用。
10. 作为 Owner，我希望新环境验证失败时可返回旧只读 fixture，而不是破坏现有可用链路。
11. 作为 Owner，我希望餐厅 Add 以后也复用同一目录与应用操作，但没有来源和确认时绝不直接建档。
12. 作为 Owner，我希望多段评论和图片 Record 以后也写入同一 Personal Memory，但在语义和幂等门完成前保持关闭。

## Acceptance Criteria

### Owner Login 与公开浏览

1. Public Read Projection v1 匿名开放 `catalog.list`、`catalog.get`、`assessment.display`、`visit.listDisplay`、`visit.getDisplay` 与 `media.openDisplay`。Catalog 只返回闭合 `PublicCatalogItemV1`：必填 `id, kind, title, area, address, description, latitude, longitude, verificationStatus, tags, sources[{label,url,role}], reservation{mode,label,checkedAt}`；可选 `alternateTitle, verifiedAt, officialUrl, tabelog{score,reviewCount,url,checkedAt}, reservation{channel,url,advanceDays,bookingWindowLabel,releaseNote}, event{startDate,endDate,displayDate}`；其余字段禁止。
2. 个人公开投影同样闭合：`PublicAssessmentV1 { itemId, favorite, manualVisited, effectiveVisited, personalRating, overallComment }`；`PublicVisitV1 { id, itemId, visitedOn, displayNote, media[] }`；`PublicVisitMediaV1 { id, visitId, displayOrder, caption, displayUrl }`。媒体二进制只能通过 `media.openDisplay` 的 opaque display ID 读取，响应仅含 allowlisted image `Content-Type`、无 filename 的 `Content-Disposition: inline` 与固定 public `Cache-Control`；严禁返回或由公开 ID 推导 R2 object key、原文件名、content hash、内部存储 ID、审计字段、receipt 或维护元数据。
3. `PublicReadManifest.authorize(operation, principal)` 必须在任何 Application/R2 调用前拒绝未知读取；允许执行后再由 `project(operation, domainResult)` 构造版本化闭合 DTO。禁止直接序列化领域对象，并以新增 sentinel field 的负测证明不会泄漏。用户已于 2026-09-21 明确确认总体评论、到访展示和照片均可公开；真实敏感内容前必须收窄投影并重审 CONTEXT/ADR。
4. 浏览器业务 `POST/PUT/PATCH/DELETE` 默认要求有效 Owner Cookie；登录 endpoint、登出和独立 Agent gateway 仅作为闭合例外。
5. 未登录写请求返回稳定的未认证结果，且 D1/R2、mutation receipt 和客户端乐观状态最终均无业务变化。
6. 登录成功后不切换到另一套页面，也不隐藏、移动或复制现有收藏、去过、评分、评论、Visit 和图片控件。
7. Login 是页面 shell 内的非 modal Owner 区域；密码错误显示就地错误并使用 `aria-invalid/aria-describedby`，提交中显示 loading 且避免重复提交，成功后焦点回到触发点或首个可操作控件，键盘焦点始终可见。
8. 原始 Owner 密码只存于 Cloudflare encrypted raw Secret `ATLAS_OWNER_PASSWORD`，Cookie signing secret 只存于 `ATLAS_OWNER_SESSION_SECRET`；后者必须由密码学安全随机源生成且至少 256-bit。登录使用常量时间比较且不记录、回显或写入 D1/R2；缺任一 Secret 即失败关闭。
9. Cookie 至少为 `HttpOnly`、`Secure`、`SameSite=Lax`，有有限有效期并携带 session version；登录校验同源请求，登出清除 session。version 或 signing secret 轮换必须使全部旧 Cookie 确定失效。当前弱密码 PoC 只允许非敏感数据，上真实数据前必须轮换并重审滥用防护。

### 单一业务事实与网页保存

10. `atlas_items` 是地点规范记录；个人总体评分、收藏、人工去过和总体评论来自 `place_assessments`，真实到访来自 `visits`，媒体来自 `visit_media`。
11. `Effective Visited State = manualVisited OR visitCount > 0` 继续成立；任何 adapter 不得复制该规则。
12. Owner 保存收藏、人工去过、0–5 总体评分或总体评论后，刷新网页仍读取相同结果。
13. 创建 Visit 后到访状态为真；删除最后一个 Visit 后仍按 manualVisited 得出最终状态。
14. `agent_catalog_items`、Nearby fixture rows 和静态 seed 不再作为 owner-poc 的并行业务事实；seed 通过 migration 进入 `atlas_items`。

### Web 与 Agent 共用操作

15. Web HTTP adapter 和 Agent HMAC adapter 只映射输入/输出并执行同一个 `AtlasApplication` operation；业务校验与持久化不得在 route/plugin 重写。
16. 两个 adapter 验证凭证后都生成统一 `InvocationContext { principal, channel, scopes, requestedAt }`。Mutation 传给 coordinator 的输入只有 `{ operation, input, mutationId, invocation }`；`InvocationCoordinator` 在 operation schema 校验与缺省值规范化后，用唯一版本化 canonicalizer 对 `{operation,input}` 计算 authoritative payload digest，再返回 `{mutationId,payloadDigest,result,replayed}` receipt。
17. 所有非幂等 mutation 在发布前必须接入原子 claim/write/receipt；Web 使用稳定 client mutation ID，Agent 使用稳定 channel event ID。幂等 assignment（如 assessment update）也携带稳定 client mutation ID 以支持响应丢失重试。
18. Web 不提交 payload digest。Agent body digest 只用于 HMAC transport 验证；gateway 可与核心重算值比对并审计，但 transport digest 不成为 claim/receipt 事实。相同 mutation ID + 相同核心 digest 回放同一 receipt；相同 ID + 不同核心 digest 返回 conflict。canonicalizer fixtures 覆盖字段顺序、缺省值和 Unicode 等价输入。
19. Web Cookie 不能访问 Agent scope，Agent HMAC 不能伪造浏览器 Owner session；两端分别失败关闭。Agent manifest 第一门只含 Nearby read；稳定事件 ID 和写门通过前，不开放个人状态、Add confirm、Record 或 destructive operation。

### Nearby、Google 与模型

20. Web 和 Agent 对相同位置文字执行同一个结构化 Nearby operation；Web 渲染结构结果，微信把同一结果呈现为文本。
21. `银座`、`銀座`、`ginza` 均可进入同一 resolver 流程；只有 Sidecar 返回的 resolved 地址/坐标可进入路线计算。
22. Nearby 候选只来自 owner D1 `atlas_items` 中 verified food；Foursquare、网页搜索和 DeepSeek 不扩大候选全集，Sidecar 也不能读取目录或个人事实。
23. Google key 只存在独立只读 Sidecar；Sidecar 配置 `workers_dev=false` 且无 routes、Owner 密码、owner D1/R2 或 Agent HMAC binding，只接受 service binding 上的闭合 typed request，并沿用 D-P04 固定 endpoint/禁 redirect 约束。上线前 preflight 必须证明直接公网 URL 不可达且未绑定 Worker 无法调用；独立复审未通过时真实 Google fail closed。
24. 月度 hard cap 固定为 Geocoding `8,000 requests`、walking Route Matrix `8,000 billable elements`。ledger key 至少为 provider + SKU + UTC period；Matrix 单位按 origins × destinations 计算，每次 egress 前原子预留，provider 失败不退款，任一 cap 或 Google Cloud quota 不满足时零对应 egress。
25. Transit Routes 暂不启用；启用前另定 request cap、费用映射与 fixtures。Foursquare 没有 secret、runtime binding 或 network call。
26. Sidecar 返回的结构化结果必须包含 Google attribution/source/checkedAt；Web 与微信就近展示。Google 原始 JSON、解析地址/坐标与路线 payload 保持 request-only，不写 owner D1/R2、日志、prompt 或 Leaflet；上线前公开 ToS/Privacy 入口必须可访问。
27. 精确 `/jpmap` 命令不调用 DeepSeek。未来语义入口先确定 `jpmap` project 与允许 operation，再让 DeepSeek只输出 schema 受限 proposal；坐标、路线、外部评分和授权字段由服务端忽略或拒绝。

### 蓝绿部署与回退

28. 新建独立 owner-poc D1/R2/config 和独立 Google Route Sidecar；旧 fixture D1/Worker 不被修改或删除。
29. 初始 seed manifest 固定为 `owner-poc-seed-v1`、`recordCount=5`、源 artifact `apps/web/features/atlas/verified-items.ts`、源 SHA-256 `45f15c384c3688489822c34a14ae69ae2490aeb07b7c239623d5d76cbe03af41`；部署门核验规范 payload/count/digest 与 D1 行一致。
30. Web URL 与 OpenClaw endpoint/HMAC 是两个独立切换面：先建库/Sidecar/Worker并完成匿名/Owner Web smoke，再灰度 Web；随后 provision 新 Agent key/endpoint、完成 owner/negative probes 后才切 OpenClaw。任一步失败只回退该入口。
31. 回退旧 URL/endpoint 是功能降级；旧资源不变，owner-poc 新写入不会反向迁移到 fixture，也不得声称回退后仍可在旧环境编辑。
32. 上真实私人数据前，轮换所有曾暴露在聊天或测试环境中的密码/key，并重新执行公开投影、鉴权和 sidecar 负面测试。

### 后续 Add 与 Record 门

33. `/jpmap add` 可先开放 discover/select/preview；即使只有一个候选也不自动写入。
34. Add confirm 只有地点发现供应商、稳定微信 event ID、D1 原子 confirm、强 identity 唯一约束和统一 mutation receipt 测试都通过后才开放。
35. Record 继续依赖逐图评分语义确认、CaptureRouteLookup、稳定事件 ID、D1/R2 原子可见性和恢复测试；本特性第一发布门不提前开放。

## Implementation Decisions

- 唯一产品接口仍是 `AtlasApplication.execute/openMedia`；凭证验证属于入口 adapter，核心只接收统一 `InvocationContext`/mutation envelope/receipt。
- 将渠道专用的 `agent.nearby` 深化为渠道无关的结构化 Nearby operation；微信 presenter 不属于该 operation 的输出契约。
- browser operation catalog 是 HTTP 映射声明；Agent tool catalog 是 scope/effect/confirmation/retry 的授权投影。二者可引用同一 operation key，但不能互相充当权限来源。
- Owner Login 使用 `ATLAS_OWNER_PASSWORD` encrypted raw Secret 的常量时间比较和 `ATLAS_OWNER_SESSION_SECRET` 签名 session，不引入用户表、OAuth、角色管理或编辑模式 UI。
- Public Read Projection v1 只开放上述 Catalog、个人总体状态/评论、Visit 与媒体的闭合 DTO；授权发生在 Application/R2 前，投影发生在执行后，禁止领域对象直序列化或暴露存储标识。
- Google Route Sidecar 是独立只读信任区；owner-poc 持有目录/个人事实和 provider ledger，Sidecar 只持 Google key、执行固定 endpoint transport 并返回闭合 evidence。
- 蓝绿 owner-poc 使用完整应用 migrations + Agent gateway/usage migrations；不得把 read-only fixture migration 当作正式 schema 基线。
- Add/Record 复用 feature 004 已评审 coordinator 与 gate，不在本特性复制一套简化写路径。

## UI Design

- 方向：复用现有 Japan Atlas 的 warm editorial atlas，不改成通用 SaaS 登录页。
- taste：`DESIGN_VARIANCE=3`、`MOTION_INTENSITY=1`、`VISUAL_DENSITY=3`。
- Login 作为当前 shell 中轻量、非 modal 的 Owner 区域；沿用现有字体、颜色、间距、圆角和阴影 token，不增加新视觉系统。
- 必须呈现 default、focus、loading、error、success 五态；loading 只使用功能性反馈，无装饰动画。
- 登录成功后控件外观和位置保持原样；触控目标至少 44×44px，正文对比度达到 WCAG AA，错误与成功提示可被辅助技术读取。

## Testing Decisions

- 最高测试接缝是带 `InvocationContext` 的 `AtlasApplication` operation contract：相同 input 分别经 Web adapter 和 Agent adapter 后读取同一 D1 状态/结构化结果。
- 公开读取 contract 逐项覆盖所有公开 DTO 的允许字段、object key/原文件名/hash/内部 ID/审计字段负面清单、未知 GET 在 Application/R2 前拒绝，并用领域 sentinel field 证明 projector 不泄漏；登录测试覆盖 Secret 缺失、至少 256-bit session secret、Cookie 缺失/过期/篡改、version/secret 轮换、同源与登出。
- mutation contract 证明 coordinator 在 schema normalization 后用唯一 canonicalizer 重算 digest；覆盖 Web 不提供 digest、Agent transport digest 不成为事实、字段顺序/缺省值/Unicode、response-lost replay 与异 payload conflict。
- migration contract 从空 owner-poc 库执行完整链，核验 seed v1 count/source digest，并验证旧 fixture 资源与配置未改变。
- Nearby contract 使用同一 Catalog/Personal Memory fixtures，验证 Web/微信候选等价、三语位置、两个 8,000 hard cap、Matrix elements、失败不退款、Transit/Foursquare 零调用、attribution 与 request-only 负面证据。
- UI 实现必须真实渲染并截图评审桌面与移动端非 modal login 的 focus/loading/error/success，以及登录后保存并刷新场景。
- Agent 写操作在未来 gate 中另外验证稳定 event ID、owner DM、第二账号、群聊、nonce、回放与冲突；未通过时 manifest 快照必须保持 read-only。

## Out of Scope

- 多用户权限、朋友只读账户、社交登录、密码找回和管理员后台。
- 当前 Public Read Projection v1 之外的字段级分享策略。
- 模型自动浏览任意网页、模型生成坐标/路线/评分、Tabelog 自动抓取。
- 第一发布门的 Add confirm、多段 Record、逐图评分和图片视觉理解。
- 删除旧 fixture 或把其数据原地升级成 owner-poc。

## Further Notes

- 用户确认: 待独立规格/架构评审后确认本工件；产品方向与默认值来自 2026-09-21 对话确认。
