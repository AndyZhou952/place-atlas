# 架构 — Owner PoC Add 增量

- 日期：2026-09-22
- 对应规格：[`spec.md`](./spec.md)
- 状态：confirmed；第 3 轮独立架构评审通过
- 用户确认：2026-09-22

## 对齐产品架构

本增量遵守 [`product/architecture.md`](../../product/architecture.md) 的模块化单体、Ports & Adapters、唯一 Application Operations 与无环依赖，落在 Application Operations、Atlas Catalog、Acquisition & Review、Conversation Coordination 四个既有模块。Application Operations 内的 `CatalogIntakeModule` 把来源发现、证据预览、会话、刷新与幂等编排收进一个深模块；最终重复／revision、`verified | needs_review` 与发布判断由 Atlas Catalog 独占。Web/Agent 只是 adapter，不复制规则或写 D1。

现有 Owner/Auth/Public Read/Nearby 架构保持不变。Add 不扩展 Google Route Sidecar；Google Geocoding/Routes 继续是 Nearby request-only，不能提供 Add durable location 或进入 Leaflet。

## 本片模块与接缝

| 模块／内部接缝 | 小接口 | 隐藏的实现 |
|---|---|---|
| `CatalogIntakeModule`（Application Operations） | `execute(discover|select|confirm|cancel, invocation)` | 闭合 DTO、Top-3、only-name proposal、状态机/TTL、provenance/freshness、confirm refresh、幂等与五路结果编排 |
| `GooglePlaceDiscoveryPort` | `discover(ownerQuery)`、`refetch(placeId)` | 返回 `transientPresentation{name,address,attribution}` 与 `durableIdentity{providerNamespace,placeId,ordinal}` 两个分区 |
| `DurableGeocoderPort` | `propose(ownerQuery, ownerDraft)` | 可持久化地址/坐标、license/provenance；Nominatim 1 req/s/cache/UA/attribution adapter 可替换 |
| `WebResearchPort` | `research(initial|confirm, intake)` | core 掌握 phase budget/digest；production adapter RPC 到 OpenClaw 同机的无状态 Research Relay，返回闭合 scalar evidence |
| `CatalogIntakeStatePort` | `load(key)`、`transition(expectedVersion,next)` | D1 session、candidate tuple、preview/CAS、24h cleanup、terminal reference |
| `AtlasCatalogIntakePort` | `publish(preview,mutationKey,expectedSessionVersion,catalogRevision)` | 深接口；production D1 adapter 在一个 transaction 内重读/CAS session preview、Catalog revision 与强 Place identity，执行 Atlas Catalog duplicate/verification/publication policy，并原子写 identity/item/snapshots/receipt/session terminal |
| Web／Agent adapters | operation input ↔ channel/UI shape | Cookie/HMAC、命令呈现、焦点/ARIA；不决定候选、事实、状态或 verification |

外部测试 seam 是 `AtlasApplication catalog.intake.*`；供应商 contract tests 分别跨三个内部 port。现有 `apps/web/product/application/catalog-intake/catalog-intake-coordinator.ts` 原地深化／替换为该模块，不建立平行实现；旧测试迁到 AtlasApplication 与 provider port contracts，删除 full-evidence session/map persistence。Foursquare 保持禁用，不能经遗留接口旁路。

## 核心数据

- `CatalogIntakeSession` 键为 owner/channel/conversation；状态为 `discovering | candidates_ready | preview_ready | committed | cancelled | expired`，D1 为权威源，accepted activity 30 分钟过期。
- Google `transientPresentation` 只可越过 port 进入当次响应，绝不持久化；D1/digest 只接收 Owner query 与 `durableIdentity`（加服务端 `createdAt`），不含 transient content 或其 hash。
- `CatalogIntakePreview` 固定 owner draft、title/address proposals、durable location evidence、Tabelog/reservation snapshots、重复项、warnings、catalog revision、version/digest；provenance/time unions沿用规格。
- `MutationKey = H(add-confirm:v1, ownerId, operation, serverSessionId, currentPreviewVersion, authoritativePreviewDigest)`；client 不传 key。receipt/minimal terminal reference 保留 180 天。
- Atlas Catalog 根据 duplicate/revision 与合法 durable identity/name/address/coords/provenance 决定 verified/needs_review/publication；Application Operations 不重判。needs_review 只在 Owner Catalog，默认不进地图/Nearby。

## 关键流程

1. **Discover → preview**：adapter 调用 discover；模块以 Owner query 请求 Google adapter，D1 只冻结 Top-3 `durableIdentity`。`transientPresentation` 仅在当次带 attribution 的非地图面板显示。select 可携带 optional owner draft；模块从 Owner query、durable geocoder 与 Agent research 形成 proposal；仅名称仍歧义时返回 clarification。
2. **Confirm → publish**：模块执行保留的 confirm research/refetch 后，将 authoritative preview、mutation key、expected session version 与 Catalog revision 交给 `AtlasCatalogIntakePort.publish`。该深接口的 D1 adapter 在同一 transaction 内重读/CAS 当前事实、执行 Catalog policy 并提交全部写入；Application 不接收可供后续提交的 decision。冲突返回新 preview/no write；成功返回闭合五路 union，response-lost 重放同 receipt。
3. **Cancel/retry/recovery**：new discover 原子取消同 key active session；discover/select/cancel 按 token/version 稳定重放。无 active session 的裸 confirm 只恢复最近 committed receipt；新 session 存在时不得误回放旧 receipt。

## 横切偏离与部署

- A-47/A-49/A-50 在本增量采用：Google 仅 transient/Place ID；durable geocoder 可替换；research 总计 1 search/5 pages/60s，并为 initial `1+3+35s`、confirm `0+2+25s` 保留不可借预算。
- Research Relay 与 OpenClaw 同部署在 Lightsail（未来随 runtime 迁移），以 protected Tunnel endpoint 满足 `WebResearchPort`；它无 D1、Owner/Catalog 凭证与产品数据。D1 session 是预算权威：RPC 前原子把整个 phase 标为 spent（不退款、无自动重试），再签发短时 allowance `{session,phase,queryOrUrlsDigest,maxCounts,deadline,requestId}`。
- Relay 只接受闭合 allowance，作防御性 URL/redirect/count/deadline 校验并关闭 transport retry；返回签名的闭合 scalar+usage 后丢弃 raw。响应丢失即保持 spent 并退回 unknown/manual，绝不第二次 egress；允许短时 transport replay defense，但不保存产品数据。core 仍掌握 proposal/digest/session，Relay/OpenClaw 不编排 confirm、不自报 provenance。
- Relay-owned hardened transport 仅允许 HTTPS:443，拒绝 URL credentials、IP literal、非批准 scheme/port 与 metadata hostname；初始 host 和每次 redirect 都解析 A+AAAA，拒绝 loopback/private/link-local/multicast/unspecified/CGNAT/ULA、云 metadata ranges/hostnames，并把连接固定到已验证 IP、保留原 TLS SNI/Host；每跳重验且最多 3 跳。OpenClaw search tool 只返回 URL candidates，canonical page 内容必须由此 transport 抓取。
- T-15 preflight/threat tests 必须证明 allowance 签名/过期/重放/预算、exact tool binding、Tunnel 身份、关闭公网绕过、零产品存储、response-loss 单次 egress，以及双栈/redirect/DNS rebinding/metadata fixtures。任一 tool/transport 保证无法兑现即关闭 Relay、保持 manual/unknown，或以后以同一 port 替换为批准的 Cloudflare search adapter。
- Tabelog 是 Owner-directed、single-intake、Agent-first best-effort；只保存 Owner confirm 的 scalar snapshot。禁止 SERP HTML/internal API/批量/绕过限制；失败为手填或 unknown。
- append-only D1 migration 增加 session/preview/identity/receipt 所需结构与唯一键；owner-poc 蓝绿环境先迁移并跑 Web/Agent contract smoke，旧 fixture 不变且仍可只读回退。
- Agent manifest 只在 T-17 双入口负面门通过后加入四个 intake operations；不暴露底层 save/update/delete。匿名 Web、错误 scope 与 direct POST 继续 fail closed。

## ADR 链接

- 继承 [`D-021`](../../docs/decisions.md) 的确定性项目路由、[`D-022`](../../docs/decisions.md) 的公开投影，以及 [`D-P03`](../../docs/decisions.md) 的可替换地点发现方向。
- [`D-P04`](../../docs/decisions.md)／[`D-P05`](../../docs/decisions.md) 只约束 Nearby；Research Relay 信任区见 Proposed [`D-P06`](../../docs/decisions.md)。本增量技术默认记录于 [`A-47/A-49/A-50`](../../product/assumptions.md)，均通过 port 保持可替换。
