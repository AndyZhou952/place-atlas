# Add 增量架构评审（第 1 轮）

- 日期: 2026-09-22
- 评审方式: subagent
- 结论: 需修改（Needs changes）

## 评审范围

独立冷读当前 `architecture.md`，对照已通过的 Add spec、`product/architecture.md`、`CONTEXT.md`、`docs/decisions.md`、feature 004 architecture 与现有 `CatalogIntakeCoordinator`/`PlaceDiscoveryProvider`。重点检查深模块、供应商内容边界、Research Relay 信任区、D1 CAS/publish、双入口等价、Nearby Sidecar 隔离、ADR 与可测试回退。

## 发现项

- [一般] `architecture.md:10,18,23,34` 对比 `product/architecture.md` 的 context map 与 feature 004 `architecture.md:21,27`: `CatalogIntakeModule` 被描述为同时隐藏“来源发现、会话、发布判定与回执”，表格又把 verification 放进该模块；但产品架构要求 Acquisition & Review 只产出证据/候选，Application Operations 负责协调，Atlas Catalog 独占 verified/abstain 决策。文字虽声称 Catalog 继续独占，公开接缝却没有可见的 Catalog decision seam，`CatalogIntakePublishPort` 容易演变成让基础设施 adapter 决定业务状态。→ 明确把现有 `CatalogIntakeCoordinator` 深化为 Application Operations coordinator；它调用 Acquisition ports 取得 proposal，再调用 Atlas Catalog 内的 `CatalogVerificationPolicy/commitDecision` 得到 `verified | needs_review | reused_existing` 决策。D1 publisher 只原子校验并持久化该领域决定、identity、receipt/session，不拥有 verification 规则。依赖图和 contract seam 应显式呈现此方向。

- [一般] `architecture.md:19,31,38`: `GooglePlaceDiscoveryPort` 说“只允许 Place ID tuple 越过接缝”，但关键流程又要求模块把 Google 瞬时 name/address 返回给带 attribution 的候选面板。若严格执行前者，UI 无内容可显示；若 adapter 返回完整对象，则“只越过 Place ID”叙述错误，容易把 transient 字段带入 preview/digest/session。→ 把 port output 明确拆成同一响应内的 `durableIdentity{namespace,placeId,ordinal}` 与 `transientPresentation{name,address,attribution}`；后者允许跨 port 但仅存活于当前 response，不得进入 state/persistence/digest/log/prompt。为 state mapper 设 closed input 只接受 durable tuple，并用负面 contract 证明 transient 字段无法穿越该 mapper。

- [一般] `architecture.md:18-26,48` 对比当前 `apps/web/product/application/catalog-intake/catalog-intake-coordinator.ts`: 仓库已经有 `CatalogIntakeCoordinator`、`CatalogIntakeStore` 与 `PlaceDiscoveryProvider`，且当前 session/preview 会冻结完整 provider name/address/coordinates/rating evidence并生成 OSM map presentation。新架构另命名 `CatalogIntakeModule`、`GooglePlaceDiscoveryPort`、`CatalogIntakeStatePort`，却没有说明是行为保持式深化/替换现有 seam 还是并行实现；按现文字实施可能留下两套 intake API 和第二事实路径，违反唯一 Application Operation 与模块局部性。→ 增加迁移视图：明确保留并深化现有 coordinator 名称/调用点，还是一次性替换并删除旧 event/store/provider wiring；列出旧 full-evidence session 被禁止复用、底层 `catalog.save_discovered` 继续隐藏、operation catalog 只登记一套 `catalog.intake.*` 的适应度测试。不要让 Foursquare/current coordinator 与新 Google path 并存为两个可写入口。

- [一般] `architecture.md:21-23,44-46,51-54`: Research Relay 新增了 Cloudflare Worker → Tunnel/narrow endpoint → Lightsail root-only service → OpenClaw search/browser → 任意已批准网页的跨云信任区，但现有 D-P01/D-P02/D-P03 没有记录这条具体拓扑与权限；`A-50` 只记录预算。与此同时架构说 core 掌握预算、relay 也执行防线，却没有规定 D1 中 initial/confirm 配额如何在并发、重试、response-lost 和 relay timeout 下原子预留，内存计数或两端各算会突破 spec hard cap。→ 新增 Proposed ADR（或至少独立、可评审的部署决策）记录 Relay 的 endpoint exposure/Tunnel auth、调用主体、tool allowlist、SSRF/DNS/redirect、模型与确定性提取边界、raw-body 丢弃、日志/保留、secret rotation、故障/关闭/迁移回 Cloudflare adapter 的条件。预算以 `CatalogIntakeStatePort` 后的 D1 ledger/CAS 为唯一权威：发出 relay 请求前原子预留 phase allowance，失败不退款或明确退款规则；relay 只验证 core 签发的 session/phase/remaining allowance 并施加更严本地上限，不建立第二计数事实。contract/fault tests 覆盖并发、重投、超时、伪造 allowance 与关闭 Relay 后 manual/unknown 回退。

## 已满足项

- 架构正文保持 80 行内量级并引用产品架构；Web/Agent 共用 `AtlasApplication catalog.intake.*` 外部测试 seam，adapter 不复制业务规则的方向正确。
- Nearby Google Route Sidecar 明确保持独立 request-only 信任区，Add 不复用其 secret、transport 或 durable location；Google/Leaflet 边界与 PASS spec 一致。
- `CatalogIntakeStatePort.transition(expectedVersion,next)` 与 publish 单一 D1 transaction 已覆盖 CAS、claim、identity/revision、item/snapshot、receipt 和 terminal state 的基本原子边界；回退保持旧 fixture 不变并明确为只读降级。
- Agent manifest 在 T-12/T-13 负面门之后才开放四个 operation，底层 save/update/delete 与匿名/direct POST 继续失败关闭。

## 结论说明

当前方案的主要产品方向可实现，但模块所有权、Google transient seam、旧 coordinator 迁移和 Research Relay 信任/预算权威尚不足以让实现者得到唯一架构。修正上述四项并补 Proposed ADR 后再做短复审。
