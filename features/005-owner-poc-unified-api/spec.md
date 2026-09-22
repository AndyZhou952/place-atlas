# 规格 — Owner PoC 统一应用操作

- 日期：2026-09-22（在 2026-09-21 已确认基线上增加 Add 规格）
- 状态：to-spec；Add 第 1 轮独立评审为需修改，已修订并待第 2 轮复审；既有 Owner/Nearby 规格保持已确认
- 用户确认：Owner/Nearby 2026-09-21；Add 产品方向 2026-09-22

## Problem Statement

用户现在能打开 Japan Atlas 地图，但收藏、去过、评分等状态无法保存，因为公开页面与线上只读 Agent fixture 使用了不匹配的数据库结构。Web 和微信也没有完整地执行同一组业务操作：浏览器拥有较完整的个人状态接口，微信目前只开放了独立的 Nearby 入口。

用户需要一个可日常试用的个人 PoC：网页可公开浏览，Owner 登录后可以使用原有控件修改；微信通过 `/jpmap` 访问同一个目录、个人状态和 Nearby 规则。模糊语义可由 DeepSeek 辅助理解，但确定性操作、权限、路线事实和写入必须由 Atlas 控制。

## Solution

建立新的蓝绿 `owner-poc` Cloudflare 环境，把完整 Atlas schema、Agent gateway tables 与 provider usage ledger 放入一个隔离 D1。`atlas_items` 是规范地点目录，`place_assessments`、`visits` 与 `visit_media` 是规范个人事实；Web 和 Agent 最终都调用同一个 `AtlasApplication` operation，只在认证适配器和输出呈现上不同。

网页增加一个与现有暖色编辑风一致的简单 Owner Login。页面与控件布局保持不变；未登录用户仍能浏览和点击现有控件，但任何写请求会要求登录或稳定失败，登录成功后原控件立即可用。浏览器写入用签名 Cookie 鉴权，Agent 请求继续使用 HMAC、owner/channel/conversation、scope 和幂等回执。

真实 Nearby 通过独立只读 Google Route Sidecar 使用 Geocoding 与 walking Route Matrix。Sidecar 只持 Google key，不绑定 Owner 密码、owner D1 或 R2；owner-poc 只通过窄结构化 service binding 发送本次位置线索与候选坐标。调用前由 owner-poc 的分 SKU ledger 预留额度，并与 Google Cloud quota 构成双门。DeepSeek 可以把模糊文字翻译为经过 schema 校验的 proposal，但不能提供坐标、路线或第三方评分事实。Foursquare 与 Transit Routes 暂不进入运行链路。

Add 增量把 `catalog.intake.discover/select/confirm/cancel` 注册为 Web 与 Agent 共用的 `AtlasApplication` operations。Google Places 只做瞬时候选匹配，长期只保存 Place ID 强身份；session 不保存 Google 名称、地址、坐标或原始响应，Google Geocoding 继续只服务 Nearby request，不为 Add 提供 durable location。Add 的长期名称与地址由 Owner 提供／确认，坐标由可切换且具有 OSM-compatible 持久化许可的 `DurableGeocoderPort` 取得并连同 provenance/license/checkedAt 保存。Agent 在 Owner 发起的单次 intake 中以现有联网／browser／search tool 尽力研究 Tabelog scalar score、reviewCount、canonical URL 与预约规则，Web／Agent 手填及 unknown 作为失败兜底；这是 Owner 接受当期来源条款风险的个人非商用 PoC，不批量抓取或绕过页面限制。所有外部事实都必须进入预览、在 confirm 时按来源规则刷新，并由 Owner 确认后才可持久化。

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
13. 作为 Owner，我希望只输入餐厅名或餐厅名加街区，就能从最多三个明确分店候选中选择并预览，避免把同名分店录错。
14. 作为 Owner，我希望网页和 `/jpmap add` 使用相同的 discover、select、confirm、cancel 规则，这样两端写出的餐厅档案一致。
15. 作为 Owner，我希望 Agent 可以在一次 Add 会话内受控查询 Tabelog 与餐厅官方／预约页面并提出评分和预约规则，但查不到、遇到歧义或受限页面时明确保持 unknown。
16. 作为 Owner，我希望 Tabelog 外部评分永远与我的个人评分分开，并能看到来源链接与核验时间。
17. 作为 Owner，我希望重复发送同一个 Add confirm 只得到同一回执而不会创建重复餐厅，即使当前微信插件还不能提供稳定事件 ID。

## Acceptance Criteria

### Owner Login 与公开浏览

1. Public Read Projection v1 匿名开放 `catalog.list`、`catalog.get`、`assessment.display`、`visit.listDisplay`、`visit.getDisplay` 与 `media.openDisplay`。Catalog 只返回闭合 `PublicCatalogItemV1`：必填 `id, kind, title, area, address, description, latitude, longitude, verificationStatus, tags`；可选 `alternateTitle, verifiedAt, officialUrl, tabelog, reservation, sources, event`，其中 `tabelog/reservation/sources` 必须严格使用下文“闭合 Add DTO 与映射”的 provenance/time discriminated unions：`owner_asserted` 只能带 `assertedAt`，`agent_observed` 只能带 `observedAt`，`durable_geocoder_observed` 只能带 `checkedAt`。其余字段禁止。缺少合法 durable coordinates 的 `needs_review` item 只通过 Owner-only Catalog/detail 投影读取，不进入要求经纬度的公开列表／地图投影。
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
17. 所有非幂等 mutation 在发布前必须接入原子 claim/write/receipt；Web 使用稳定 client mutation ID，Agent 通常使用稳定 channel event ID。Add confirm 是有意收窄的例外：它使用服务端不可变 intake session、preview version 与 preview digest 派生稳定 product mutation key；Record、媒体及其他 Agent 写入仍需稳定 channel event ID。幂等 assignment（如 assessment update）也携带稳定 client mutation ID 以支持响应丢失重试。
18. Web 不提交 payload digest。Agent body digest 只用于 HMAC transport 验证；gateway 可与核心重算值比对并审计，但 transport digest 不成为 claim/receipt 事实。相同 mutation ID + 相同核心 digest 回放同一 receipt；相同 ID + 不同核心 digest 返回 conflict。canonicalizer fixtures 覆盖字段顺序、缺省值和 Unicode 等价输入。
19. Web Cookie 不能访问 Agent scope，Agent HMAC 不能伪造浏览器 Owner session；两端分别失败关闭。Agent manifest 按 phase 只开放明确 operations；Add 独立门通过后可开放 intake operations，但稳定事件 ID 和 Record 写门通过前仍不得开放 Record、媒体或 destructive operation。

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

### Add intake、外部证据与 Record 门

33. Web 与 Agent 只通过 `catalog.intake.discover/select/confirm/cancel` 完成 Add；任何 adapter、网页 route 或 Agent tool 都不得直接调用底层 Catalog insert/update。即使只有一个候选，也必须进入预览并由 Owner confirm，不能自动写入。
34. `catalog.intake.discover` 接受餐厅名加可选街区／地址，或完整地址。session 可保存 Owner 原始 query 及其 NFC/trim 规范化值；这属于 Owner input，不是 Google content。Google Places 只在 discover/select/confirm 时按需瞬时请求；durable candidate session 每项只能保存 `{ providerNamespace, placeId, ordinal, createdAt }` 及不含 Google content 的服务端状态。candidate-set digest 只能由这些允许 tuple 计算；禁止保存名称、地址、坐标、raw response、搜索正文、派生摘要或任何 Google transient content hash 到 D1/R2/log/prompt/receipt。select/preview 可按 Place ID 重新请求，并在带 Google Maps attribution 的非地图候选面板瞬时显示；Google Places／Geocoding content 不得进入 Leaflet。
35. 候选先按 provider relevance 降序，再按规范化 Place ID 升序做稳定 tie-break，截取 Top 3；超过三项时返回 `hasMore=true` 并要求 Owner 补充街区／地址，不提供翻页或系统性枚举。ordinal 只绑定本次已保存的 Place ID 列表，select 不得重新搜索后重编号。Google Place ID 只作强身份；Google Geocoding 继续仅用于 Nearby request-only，不参与 Add durable 地址／坐标。
36. Add 的 durable `title/address` 必须由 Owner 明确输入或在 preview/confirm 明确确认，不能把 Google 文本经一次点击改标为 Owner 数据以规避来源政策。仅名称 `/jpmap add <name>` 是正常入口：服务端可从 Owner query 规范化出 title proposal；`DurableGeocoderPort` 可用 Owner query 加 Owner title/area 搜索 durable address/coordinates proposal，Agent research 也可从允许的官方来源提出 address evidence。若仍歧义，preview 明确追问 area/address；Owner 可补充后生成新版 preview，或在证据不足时确认保存 needs_review。Google transient name/address 永远不能成为 durable proposal、持久化字段或 Leaflet 输入。
37. PoC 可选 public Nominatim adapter，但必须直接由一次 Owner 操作触发、全应用合计不超过 1 request/second、发送可识别应用的有效 User-Agent 或 Referer、缓存重复请求、清晰显示 OpenStreetMap attribution，并可仅通过服务端配置切换 provider；禁止 autocomplete、定时／批量／系统性查询和 details scraping。policy 或 provider 未配置时 Add 仍可保存 needs_review。
38. Agent 命令流程固定为 `/jpmap add <query>` → `/jpmap add select <n>` → preview → `/jpmap add confirm` 或 `/jpmap add cancel`。状态闭合为 `discovering | candidates_ready | preview_ready | committed | cancelled | expired`；合法转移只有 discover→candidates_ready、select→preview_ready、evidence edit 或 confirm-refresh conflict 的 `preview_ready→preview_ready`（必须递增 preview version）、confirm→committed、active→cancelled/expired。连续不活动固定 30 分钟，`now - lastAcceptedActivityAt >= 30:00` 即 expired；只有成功 discover/select、合法 preview edit、获准 research refresh 或 confirm/cancel 才是 accepted activity，invalid/unauthorized/dependency failure/polling 不续期。
39. 同一 `ownerId + channel + conversationId` 同时至多一个 active session；新 discover 原子取消同 key 的旧 active session并新建。Agent 使用已认证渠道 conversation ID；Web 在首次 discover 由服务端生成至少 128-bit opaque `webConversationId`，浏览器仅存于 `sessionStorage`，Owner Cookie 才是授权凭证。D1 是 session 权威源，Worker 重启不丢状态；并发状态转移用 version compare-and-swap。cancelled/expired session 的候选与 preview 最迟 24 小时清理，mutation receipt 与最小 terminal reference 保留 180 天。
40. Tabelog 的个人非商用 PoC 主路径是 Owner 发起的 single-intake、best-effort Agent research：Agent 可用现有获准联网／browser／search tool 定位 canonical Tabelog URL，读取页面可见的 scalar score/reviewCount，并查询餐厅官网／官方预约页的预约规则，形成 preview proposal；Owner confirm 后可长期保存该最小 scalar snapshot。Web 也允许 Owner 手填；Agent 无工具、失败或遇到歧义时提示 Owner 粘贴 score + canonical URL，手填／unknown 是兜底而不阻塞 Add。
41. `WebResearchPort` 必须把研究限制在 Owner 当前的一条 intake，全会话硬上限保持 1 次 search-tool query、5 个 page requests、60 秒。预算在 phase 间预留且不得互借：initial research 最多 1 search + 3 pages + 35 秒；confirm refresh 不得新 search，只能使用 preview 已保存的 canonical URLs，最多 2 pages + 25 秒；每个 request 最多 15 秒和 3 次 redirect。任一 phase 自身上限命中即停止该 phase，preview 不得消耗 confirm reserve。禁止批量／系统性爬取、Google SERP HTML 抓取、internal API、登录／CAPTCHA／paywall/rate-limit 绕过以及评论正文、HTML、图片或搜索结果持久化。可以使用获准 search tool／browser 结果定位 canonical URL；页面明确阻止、冲突或不可访问即停止并返回 unknown。
42. Agent proposal 只可返回标量 Tabelog snapshot 与预约规则 snapshot。Tabelog 必须有 score、canonical URL、`provenance=agent_observed`、`observedAt`，review count 可选；Owner 手填保存 `provenance=owner_asserted` 与 `assertedAt`，不是 checkedAt/observedAt；任何 Agent proposal 被 Owner 修改后，修改字段逐字段降级为 owner_asserted。预约规则优先餐厅官网或其明确链接的官方预约来源；只有来源明确给出数字提前天数才保存 `advanceDays`，否则只保存简短 sourced label/note。`reservable` 不证明 walk-in 或 queue；动态 walk-in/queue 始终保持 request-time unknown，除非 Nearby 当次另有当前证据。
43. preview 绑定 immutable server session、candidate IDs、Owner assertions、provider observations、durable geocoder evidence、preview version/digest 与 catalog revision。discover 可取得新的 Place ID 列表；select 可按选中 Place ID 重取 request-only candidate；preview 可重跑 durable geocoder 与已批准 research；confirm 必须再次重取选中 Place ID identity、可用 durable geocoder evidence及所有 enabled provider observations并比较 authoritative evidence digest。任何 identity/evidence/catalog revision 变化都生成新 preview/version并返回 conflict；30 分钟 TTL 不能替代 confirm-time refresh，陈旧 research 不得直接提交，refresh 失败的字段变 unknown 或保留历史值但标 stale，不能冒充 fresh。
44. Add mutation key 只能由服务器以 versioned/domain-separated canonical derivation `add-confirm:v1 + ownerId + operation + serverSessionId + currentPreviewVersion + authoritativePreviewDigest` 生成，client 不得提交 key。confirm 顺序固定为：认证 owner/channel/conversation 并加载 session → 若已 committed 且 key/digest 相同先回放 receipt → 原子校验 active、`preview_ready`、未过期、current version/digest → confirm-time refresh/digest/revision/strong identity 检查 → claim key → 唯一性/写入 → terminal receipt 与 committed 状态；claim、item、identity、snapshot、receipt 必须在同一 D1 transaction。
45. 未提交的 expired/cancelled/旧 preview 均稳定拒绝且零写入；跨 owner/channel/conversation 不可读取或重放。已 committed 的同 key 即使 session 后来超过 TTL 仍在 180 天内回放相同 receipt；不同 digest 为 conflict。conversation 没有新 active session 时，裸 `/jpmap add confirm` 可解析该 conversation 最近 committed confirm receipt以恢复 response-lost；一旦开始新 session，裸 confirm 只能指向新 active preview，不得误回放旧 receipt，并提示用 receipt reference/status command 查询旧结果。discover 的同 request token 重试回放同 candidate mapping，select 的同 session/version/ordinal 重试回放同 preview，cancel 重试回放同 cancelled 结果；异 payload/version 一律 conflict。
46. confirm 对外是闭合五路 union：`committed_verified | committed_needs_review | reused_existing | conflict | failed_no_write`；`reused_existing` 返回既有 item 的独立 receipt/result，且不伪装为新 commit。只有合法 durable identity、Owner-confirmed name、可持久化地址与坐标、完整 provenance/license/time 且无冲突才 `committed_verified`；否则 `committed_needs_review`。两种 committed 结果均可在 Owner Catalog/detail 查看并允许后续 Visit，needs_review 带标记且默认不在公开地图或 verified-only Nearby；事务失败不得留下可见 item、identity 或 receipt。
47. 日本以外（中国大陆除外）的 Google external rating 是后续扩展，只记录为 GitHub #12；本次 Add 不读取、显示或持久化 Google review/rating，中国大陆地区也不要求外部评分。
48. Record 继续依赖逐图评分语义确认、CaptureRouteLookup、稳定 channel event ID、D1/R2 原子可见性和恢复测试；Add 的 product mutation key 例外不得扩展到 Record。

## Implementation Decisions

- 唯一产品接口仍是 `AtlasApplication.execute/openMedia`；凭证验证属于入口 adapter，核心只接收统一 `InvocationContext`/mutation envelope/receipt。
- 将渠道专用的 `agent.nearby` 深化为渠道无关的结构化 Nearby operation；微信 presenter 不属于该 operation 的输出契约。
- browser operation catalog 是 HTTP 映射声明；Agent tool catalog 是 scope/effect/confirmation/retry 的授权投影。二者可引用同一 operation key，但不能互相充当权限来源。
- Owner Login 使用 `ATLAS_OWNER_PASSWORD` encrypted raw Secret 的常量时间比较和 `ATLAS_OWNER_SESSION_SECRET` 签名 session，不引入用户表、OAuth、角色管理或编辑模式 UI。
- Public Read Projection v1 只开放上述 Catalog、个人总体状态/评论、Visit 与媒体的闭合 DTO；授权发生在 Application/R2 前，投影发生在执行后，禁止领域对象直序列化或暴露存储标识。
- Google Route Sidecar 是独立只读信任区；owner-poc 持有目录/个人事实和 provider ledger，Sidecar 只持 Google key、执行固定 endpoint transport 并返回闭合 evidence。
- 蓝绿 owner-poc 使用完整应用 migrations + Agent gateway/usage migrations；不得把 read-only fixture migration 当作正式 schema 基线。
- Add/Record 复用 feature 004 已评审 coordinator 与 gate，不在本特性复制一套简化写路径。Add 对外固定为 `catalog.intake.discover/select/confirm/cancel`；候选 Place ID mapping、preview、research proposal、session state/expiry 与 terminal receipt 是服务端权威状态。
- Google Places discovery port 与 `DurableGeocoderPort` 是不同信任边界：前者只有 Place ID 可持久化，后者必须逐字段携带 `provenance/license/sourceUrl/checkedAt` 并允许替换实现。Public Nominatim 只是 PoC 可选 adapter，其 1 req/s、identifying UA/Referer、cache、attribution、no autocomplete/systematic scraping 和 provider switch 是 contract，不是调用方约定。
- `WebResearchPort` 是 Owner-directed single-intake 的受控采集边界，只返回 scalar proposal；工具可用性、页面阻止、速率、预算、超时、正文丢弃与 fail-closed 由 adapter 隐藏。DeepSeek 只组织 proposal，不把研究结果变成模型记忆或直接写 Catalog。

### 闭合 Add DTO 与映射

- 所有文本先 Unicode NFC、trim 并拒绝 control characters：`query 1..500`、`title 1..200`、`address 1..500`、`area 0..120`、`label/channel 0..120`、`bookingWindowLabel/releaseNote 0..500`。所有外部 URL 必须 canonical HTTPS、无 credentials、去 fragment；Tabelog canonical URL 还必须匹配明确允许的 Tabelog host/path。
- operation input 闭合为：`discover { query, requestToken }`；`select { sessionId, expectedSessionVersion, ordinal, ownerFields?:{title?,address?,area?,coordinates?}, tabelog?:OwnerTabelogAssertion|'unknown', reservation?:OwnerReservationAssertion|'unknown', requestResearch:boolean }`；`confirm { sessionId, expectedPreviewVersion }`；`cancel { sessionId, expectedSessionVersion }`。ownerFields 是 draft，title/address 不要求同时存在；仅名称流程可先生成 title/location proposals，仍歧义时 select success 返回 clarification。初次 select 与同 ordinal 的 evidence edit 都通过 select 创建新 preview/version，不存在隐藏的第五条写路径。Web/Agent 都不得提交 mutation key、verification status、Agent/geocoder provenance、observedAt/checkedAt 或 arbitrary source fields。
- discover output 只含 `{ sessionId, sessionVersion, state, candidates[{ordinal, transientName, transientAddress, attribution}], hasMore, expiresAt }`；`transientName/address` 来自本次 Google response，仅响应内显示且不进入 session/receipt。session durable candidate 只含 AC34 的 Place ID mapping。
- `LatLng={latitude,longitude}` 要求 finite numbers、`-90 <= latitude <= 90`、`-180 <= longitude <= 180`。 `locationEvidence` 精确为 `{status:'unknown'} | {status:'known',provenance:'durable_geocoder_observed',normalizedAddress,latitude,longitude,provider,sourceUrl,license,checkedAt} | {status:'known',provenance:'owner_asserted',address,latitude,longitude,assertedAt,sourceUrl?}`；任何越界／NaN/Infinity 输入均为 invalid_input。
- preview DTO 闭合为 `{ sessionId, previewVersion, state:'preview_ready', candidateIdentity:{providerNamespace,placeId}, ownerFields:{title?,address?,area?,coordinates?}, titleProposal?, addressProposal?, clarification?, locationEvidence, tabelog, reservation, suspectedDuplicates, unknownFields, warnings, evidenceDigest, catalogRevision, expiresAt }`。嵌套类型精确为：`TitleProposal={provenance:'owner_query',value} | {provenance:'agent_observed',value,sourceUrl,observedAt}`；`AddressProposal={provenance:'durable_geocoder_observed',value,sourceUrl,license,checkedAt} | {provenance:'agent_observed',value,sourceUrl,observedAt}`；`Clarification={code:'missing_area_or_address'|'ambiguous_location'|'duplicate_suspected',prompt,fields:('title'|'area'|'address'|'coordinates')[]}`，其中 prompt 为 1..300 字符，fields 最多 4 个、唯一且按 title→area→address→coordinates 枚举序；`SuspectedDuplicate={itemId,title,address?,match:'strong'|'weak'}`，数组最多 5 项、itemId 唯一并稳定按 strong→weak 后 itemId 升序；`unknownFields:('address'|'coordinates'|'tabelog'|'reservation')[]` 最多 4 个、唯一且按 address→coordinates→tabelog→reservation 枚举序；`Warning={code:'stale_evidence'|'provider_unavailable'|'source_conflict'|'needs_review',message}`，message 为 1..300 字符，warnings 最多 4 项、code 唯一且按 stale_evidence→provider_unavailable→source_conflict→needs_review 枚举序。不允许 any/arbitrary nested fields。每个 evidence 字段携带自身 provenance/time；Owner 编辑 Agent proposal 后只降级被编辑字段，不污染其他字段。`freshness` 只允许 `fresh | stale`，unknown 通过 snapshot status 表达。
- `tabelog` 是 `{status:'unknown'} | {status:'known', score, reviewCount?, url, provenance:'agent_observed', observedAt, freshness} | {status:'known', score, reviewCount?, url, provenance:'owner_asserted', assertedAt, freshness}`；score 为有限数 `0.00..5.00` 且最多两位小数，reviewCount 为 `0..2147483647` 整数。Tabelog 与 personal rating 永不互转。
- `reservation` 精确为 `{status:'unknown'} | {status:'known',mode:'reservable'|'reservation_required',label,advanceDays?,bookingWindowLabel?,releaseNote?,channel?,url,provenance:'agent_observed',observedAt,freshness} | {status:'known',mode:'reservable'|'reservation_required',label,advanceDays?,bookingWindowLabel?,releaseNote?,channel?,url,provenance:'owner_asserted',assertedAt,freshness}`。已知预约规则必须有 canonical source URL；`advanceDays` 仅允许明确来源的 `0..3650` 整数。
- 持久化只保存 Owner-confirmed `title/address/area`、Place ID 强身份、合法 durable location evidence、上述最小 Tabelog/reservation snapshots、sources 与 verification status；不保存 transient Google content。`sources[]` 精确为 `{role:'identity'|'location'|'tabelog'|'reservation',label,url?,provenance:'owner_asserted',assertedAt} | {role:'identity'|'location'|'tabelog'|'reservation',label,url,provenance:'agent_observed',observedAt} | {role:'location',label,url,provenance:'durable_geocoder_observed',checkedAt,license}`；Owner assertion 不必虚构 URL，不得混用时间字段或省略 geocoder license。
- 所有 operations 返回 `Result<Success,AddError>`，`AddError.code` 闭合为 `invalid_input | unauthorized | forbidden | not_found | conflict | expired | dependency_failure | rate_limited | unexpected_failure`，只含安全 `message` 与可选 `retryable`，不允许 any/arbitrary details。`discover` success 为 `{status:'candidates_ready'|'clarification_required',sessionId,sessionVersion,candidates,hasMore,expiresAt}`；`select` success 为 `{status:'preview_ready'|'clarification_required',sessionId,sessionVersion,preview?,clarification?,expiresAt}`；`ConfirmOutcome` 闭合为 `{status:'committed_verified'|'committed_needs_review'|'reused_existing',itemId,receiptRef,replayed} | {status:'conflict',newPreview} | {status:'failed_no_write',reason:'validation'|'dependency'|'transaction'}`；`cancel` success 固定为 `{status:'cancelled',sessionId,replayed}`，重复 cancel 回放同一结果。
- public mapping 严格从 persisted snapshot 投影：Owner assertion 显示“Owner provided”与 assertedAt，Agent observation 显示来源与 observedAt，durable geocoder 显示 attribution/license 与 checkedAt。Tabelog 超过 7 天、预约规则超过 30 天显示 `stale`；刷新失败保留历史 scalar 但显示 stale + warning，不更新 time，也不能被呈现为当前事实。unknown 不生成虚假来源；walk-in/queue 不从 reservation 派生。

## UI Design

- 方向：复用现有 Japan Atlas 的 warm editorial atlas，不改成通用 SaaS 登录页。
- taste：`DESIGN_VARIANCE=3`、`MOTION_INTENSITY=1`、`VISUAL_DENSITY=3`。
- Login 作为当前 shell 中轻量、非 modal 的 Owner 区域；沿用现有字体、颜色、间距、圆角和阴影 token，不增加新视觉系统。
- 必须呈现 default、focus、loading、error、success 五态；loading 只使用功能性反馈，无装饰动画。
- 登录成功后控件外观和位置保持原样；触控目标至少 44×44px，正文对比度达到 WCAG AA，错误与成功提示可被辅助技术读取。
- Add 延续同一 warm editorial atlas，不另建 SaaS wizard；在一个 Owner 区域内依次呈现 query、候选、evidence preview 与成功回执。loading/empty/ambiguous/error/preview/success/expired/conflict 都使用既有 token。
- empty 提供“补充街区或完整地址”CTA；error 保留原输入并提供重试；ambiguous 使用原生 radio group 或语义等价 listbox，每项显示瞬时名称、地址、来源与 Google Maps attribution，Top 3 之外提示补充线索；不得把候选放进 Leaflet。
- expired/conflict/stale preview 提供“生成新预览”CTA；disabled confirm 旁有可访问的具体原因。异步区域使用 `aria-busy`，结果／成功使用合适的 status live region，字段错误使用 `aria-invalid/aria-describedby`；登录失效、阶段切换、expired/conflict 后焦点移到新阶段标题或错误摘要。所有输入、候选与 CTA 触控目标至少 44×44px，键盘完成全部流程。

## Testing Decisions

- 最高测试接缝是带 `InvocationContext` 的 `AtlasApplication` operation contract：相同 input 分别经 Web adapter 和 Agent adapter 后读取同一 D1 状态/结构化结果。
- 公开读取 contract 逐项覆盖所有公开 DTO 的允许字段、object key/原文件名/hash/内部 ID/审计字段负面清单、未知 GET 在 Application/R2 前拒绝，并用领域 sentinel field 证明 projector 不泄漏；登录测试覆盖 Secret 缺失、至少 256-bit session secret、Cookie 缺失/过期/篡改、version/secret 轮换、同源与登出。
- mutation contract 证明 coordinator 在 schema normalization 后用唯一 canonicalizer 重算 digest；覆盖 Web 不提供 digest、Agent transport digest 不成为事实、字段顺序/缺省值/Unicode、response-lost replay 与异 payload conflict。
- migration contract 从空 owner-poc 库执行完整链，核验 seed v1 count/source digest，并验证旧 fixture 资源与配置未改变。
- Nearby contract 使用同一 Catalog/Personal Memory fixtures，验证 Web/微信候选等价、三语位置、两个 8,000 hard cap、Matrix elements、失败不退款、Transit/Foursquare 零调用、attribution 与 request-only 负面证据。
- UI 实现必须真实渲染并截图评审桌面与移动端非 modal login 的 focus/loading/error/success，以及登录后保存并刷新场景。
- Add 的最高公开测试缝是 `AtlasApplication catalog.intake.*` contract：同一 fixtures 分别经 Web Cookie adapter 与 Agent HMAC adapter 执行 discover/select/confirm/cancel，证明候选、preview、强／弱重复、闭合五路 confirm union、最终 item 与 receipt 等价；匿名 Web、第二账号、群聊、错误 scope 与 direct POST bypass 均零写入。
- Google discovery contract 证明 D1/R2/log/prompt/receipt 只含 provider namespace、Place ID、ordinal、createdAt 与服务端状态；candidate-set digest 只覆盖这些允许 tuple，不存在 transient Google content hash，瞬时 name/address/coords/raw 为零；Top-3 relevance + Place ID tie-break 稳定、>3 返回 hasMore，select/confirm 重新请求且有 Google Maps attribution，Leaflet 收到 Google Places/Geocoding content 为零。
- `DurableGeocoderPort` contract 覆盖许可/provenance/license/time 闭合与 provider 替换；public Nominatim fixtures 验证真实用户触发、全应用 ≤1 req/s、有效 UA/Referer、cache、OSM attribution、禁 autocomplete/systematic/details scraping、配置切换及失败后 needs_review。Owner 明确手填坐标与普通地址输入分别产生 owner_asserted／无坐标行为。
- `WebResearchPort` contract 使用受控 fixtures 验证全会话 1 search/5 pages/60 秒硬上限，以及 initial 1+3+35 秒与 confirm 0+2+25 秒不可借用的 reserve；confirm 只用 preview canonical URLs，每 request 15 秒/3 redirects。另验证 scalar-only 映射、Agent observation 与 Owner assertion 分离、Owner 修改逐字段 provenance 降级、页面阻止/rate limit/login/paywall/CAPTCHA、redirect/SSRF、原始正文丢弃及 fail-closed；断言无 Google SERP HTML、internal API、review text、图片、HTML、模型记忆或 provider 原文持久化。
- session contract 覆盖 `discovering/candidates_ready/preview_ready/committed/cancelled/expired` 全状态表，29:59/30:00 边界、accepted activity 续期、new-discover replacement、Web opaque conversation、重启恢复、CAS 并发、24 小时 cleanup、跨入口/owner/conversation deny；discover/select/cancel 的同 token/version 重试稳定且异 payload conflict。
- Add 幂等 contract 覆盖 `add-confirm:v1` 全部派生字段、client key 拒绝、confirm-time refresh/evidence digest、同 preview response-lost replay、不同 digest conflict、expired/cancelled/旧 preview、并发双确认、catalog revision/Place ID 占用变化、committed 后 TTL、180 天 receipt、无 active session 的最近 receipt recovery 与新 session 不误回放旧 receipt；证明 Add 无 channel event ID 仍只有一个 item/receipt。Record 仍必须证明稳定 channel event ID。
- DTO/public projection contract 覆盖 NFC/长度/URL/range/precision、closed union、provenance 与时间字段不冒充、7/30 天 freshness、refresh failure stale warning、needs_review Owner-only 与地图/Nearby 排除、walk-in/queue 始终不从预约推断；并精确断言 clarification/warning 的 1..300 文本边界、fields/unknownFields/warnings 的上限／唯一性／枚举序，以及 suspectedDuplicates 最多 5、itemId 唯一、strong-before-weak + itemId 升序。
- Add UI 真实渲染与截图／交互评审逐项覆盖桌面和移动的 loading、empty CTA、保留输入的 error retry、原生 radio/listbox ambiguous、preview、success、登录失效、expired/conflict 新预览 CTA、disabled reason、`aria-busy`、live region、`aria-invalid/aria-describedby`、阶段焦点、全键盘路径与 ≥44×44px；verified 成功后地图读到同一 item，needs_review 只在 Owner Catalog 显示。

## Out of Scope

- 多用户权限、朋友只读账户、社交登录、密码找回和管理员后台。
- 当前 Public Read Projection v1 之外的字段级分享策略。
- 任意／批量网页抓取、登录／付费墙／CAPTCHA 绕过、评论正文或图片采集、原始 HTML 持久化、模型把网页内容记为长期事实，以及绕过预览确认的自动写入。
- Google 搜索结果 HTML、Tabelog internal API 或页面限制规避；Agent 只可使用现有获准 search/browser 工具做 Owner 发起的 single-intake best-effort 研究。
- 模型生成坐标、路线、评分、预约规则或身份事实；DeepSeek 只提出 schema proposal。
- GitHub #12 的日本以外（中国大陆除外）Google external rating、Google review 正文与跨地区评分归一。
- 多段 Record、逐图评分和图片视觉理解；Record 仍受稳定 channel event ID 与独立增量规格门约束。
- 删除旧 fixture 或把其数据原地升级成 owner-poc。

## Further Notes

- Google Places 的 Place ID、attribution 与内容存储边界继续以 [Google Places API policies](https://developers.google.com/maps/documentation/places/web-service/policies) 和 [Place ID overview](https://developers.google.com/maps/documentation/places/web-service/place-id) 为依据。Google Geocoding 继续受 [Geocoding policies](https://developers.google.com/maps/documentation/geocoding/policies) 与当前 [Google Maps Platform Service Specific Terms §6.2/§6.3](https://cloud.google.com/maps-platform/terms/maps-service-terms) 约束；Add 不把其 content 存进 Atlas 或放上 Leaflet。
- Public Nominatim adapter 必须持续符合 [Nominatim Usage Policy](https://operations.osmfoundation.org/policies/nominatim/)；durable OSM 数据与界面 attribution 依据 [OSMF Geocoding Guideline](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Geocoding_-_Guideline) 和 [Attribution Guidelines](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)。
- Owner 已知悉 [食べログ利用規約](https://tabelog.com/help/rules/) 与 [robots.txt](https://tabelog.com/robots.txt) 的当期不确定性，仍选择在个人非商用 PoC 中让 Agent 对 Owner 单次指定餐厅做 best-effort scalar research，并接受来源随时不可用／需关闭的风险；这不是批量抓取授权，也不允许绕过页面限制。
- 用户确认: 2026-09-22 确认 Agent-first、Owner-directed Tabelog best-effort research、确认后保存 scalar snapshot、手填/unknown 兜底以及 Google external rating 延后 GitHub #12 等产品选择；同日确认通过第 3 轮独立评审的最终增量架构，A-47/A-49/A-50 因而转为已确认架构约束。
