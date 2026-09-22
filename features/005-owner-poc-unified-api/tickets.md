# 任务票 — Owner PoC 统一应用操作

- 状态：implement T-14；T-13 第 2 轮 code-review PASS 且用户于 2026-09-22 明确确认；T-08 只读 SSH 已健康，但仍缺切换后的 live 正反向证明
- 执行方式：垂直切片优先；中央 composition、migration journal 与 operation catalog 由主任务串行汇合
- 公开/权限确认：持 URL 者可查看 Catalog、总体评论、Visit 展示与照片原图；internal ID、存储 key、hash、audit 保持私有；只有 Owner 可以写入

## 第一门：网页可安全保存

- [x] T-01 owner-poc 蓝绿 schema 与 seed manifest 行走骨架 — Blocked by: None — 新的隔离 D1/R2/Worker 已 provision，旧资源保持不变；0001–0005 migrations、seed evidence、preflight、fresh placeholder 一次性 bootstrap 与最终 strict deploy 均通过，脱敏证据见 `evidence/deployment-smoke-2026-09-21.md`。
- [x] T-02 Public Read Manifest 与 OwnerCredential 行走骨架 — Blocked by: T-01 — 本地合同与远端 smoke 均通过：公开 Catalog/Journal 可读，鉴权先于 Application/R2，公开闭合 DTO/媒体流不泄漏 object key/filename/hash/internal ID/audit；匿名同源写入和错误登录 fail closed。
- [x] T-03 统一 InvocationContext、mutation receipt 与网页个人状态 — Blocked by: T-02 — 本地实现与验证完成：schema normalization 后计算 authoritative digest，Web 不提交 digest，原子 claim/write/receipt 覆盖 replay、conflict、并发 pending、lease takeover 与 response-lost retry。
- [x] T-04 Visit/媒体统一 mutation 与公开投影 — Blocked by: T-02, T-03 — 本地实现与验证完成：Visit/media 使用 Owner 门与统一 receipt，匿名媒体经 opaque display ID 读取，私有字段负测通过；Agent Record 仍未开放。

## 第二门：Web 与微信共享真实 Nearby

- [x] T-05 渠道无关 Nearby operation 预重构 — Blocked by: T-01 — 已用结构化 `nearby.recommend` 取代 owner-poc 中渠道专用 reply contract；Web 与微信 presenter 适配同一闭合 result，composition 不再依赖 `agent_catalog_items`/fixture personal facts；独立第 2 轮代码评审通过。
- [x] T-06 独立 Google Route Sidecar 与双 hard cap — Blocked by: T-01, T-05 — 本地安全门、远端 encrypted Secret、private strict deploy、公网不可达、Google Cloud key/quota/billing guard 与 Owner Worker 精确 service binding 均已完成。v3 key 鉴权与 provider status 误分类已 TDD 修复、独立复审并重新 strict deploy；修复后 live Owner smoke 以 `東京都江東区平野2-16-14` 成功返回 `コーヒー マメヤ カケル`，确认真实 provider 链路闭合。
- [x] T-07 Web/Agent/Sidecar 等价与 request-only 契约 — Blocked by: T-03, T-05, T-06 — Browser adapter 与 HMAC gateway 已对同一 Catalog、个人事实和位置文字返回等价闭合结果；Sidecar 原始 JSON、地址/坐标/路线不进入 D1/R2/log/prompt/Leaflet。Terms/Privacy 远端 200，Nearby 全响应 `no-store`，新查询不会沿用旧距离；独立最终代码/UI 评审通过。
- [ ] T-08 确定性 `/jpmap nearby` owner-poc E2E（本地代码评审 PASS；`52.78.102.220` 的 OpenClaw/plugin 只读 SSH 健康）— Blocked by: T-07 — 当前仍使用旧 endpoint；尚未授权执行 owner-poc endpoint/key 切换、重启与 signed 正反向 probes，因此现场验收未关闭。精确命令零模型调用，覆盖 `银座/銀座/ginza`、owner DM、第二账号、群聊、错误 scope、nonce replay 与 Worker audit；旧 fixture 保持可回退。本地坐标粗筛／Top-N 性能优化由 GitHub #11 跟踪并交叉引用 feature004/T-06A，不阻塞本票。

## 第三门：语义辅助与发布

- [ ] T-09 受限 DeepSeek semantic proposal — Blocked by: T-08 — 在项目与 phase allowlist 已确定后，允许模型把模糊位置文字翻译为 schema 受限 proposal；拒绝模型提供的 operation、权限、坐标、路线与评分事实。模型失败时精确 `/jpmap` 命令继续可用。
- [x] T-10 非 modal Owner Login UI 真实渲染门 — Blocked by: T-03 — 本地 UI 门与远端 smoke 均完成；用户已确认 Owner 登录以及总体评论、喜欢、去过状态的写入与读回。体感写入延迟另由 GitHub #10 跟踪。
- [ ] T-11 双入口蓝绿部署与回退演练 — Blocked by: T-04, T-07, T-08, T-10 — 新 Web Worker 的 strict deploy、公开/Owner smoke 与 AWS signed Agent 正负 probe 已完成；T-08 尚未完成，永久 OpenClaw endpoint 切换及其回退演练仍未执行，因此不得标记完成。

## 后续受门禁约束的共享写入

- [x] T-12 Add CatalogIntake walking skeleton 与闭合 contracts（第 3 轮 code-review PASS；用户于 2026-09-22 确认）— Blocked by: T-03 — 原地深化 `catalog-intake-coordinator.ts` 为 Application Operations 的 `CatalogIntakeModule`，注册 `catalog.intake.discover/select/confirm/cancel` 闭合 input/output/error 与内存 fixture ports；迁移遗留 full-evidence 测试到 `AtlasApplication catalog.intake.*` 和 provider contract tests，删除旧 session/map evidence persistence，证明无平行 coordinator、Foursquare/底层 save/update/delete/direct POST 旁路且 `POST /api/items` 仍 503。验收证据：完整测试 479/479、聚焦 contract 10/10；用户确认后进入 T-13。
- [x] T-13 持久 session/CAS 与 transient Google discover/select（第 2 轮 code-review PASS；用户于 2026-09-22 确认）— Blocked by: T-12 — append-only D1 session/CAS、30 分钟 inactivity TTL、180 天 terminal/request retention、Google Top-3 transient projection 与 owner-poc daily cleanup 均已完成；并发续期不会被误报过期或被清理误删。验收证据：聚焦 contracts 27/27、完整测试 496/496、TypeScript、lint、format-check、diff-check 与 owner-poc production build 全部通过。
- [ ] T-14 durable geocoder、only-name 与可访问 Web preview — Blocked by: T-13 — 接入可替换 `DurableGeocoderPort`，以 Owner query/draft 形成 title/address/location proposal；PoC Nominatim adapter 满足直接用户触发、全应用 <=1 req/s、有效 UA/Referer、cache、OSM attribution、禁止 autocomplete/systematic scraping，失败可 Owner 手填并保存 needs_review。Web 复用 operations，验收 only-name 正常预览/追问、provenance/LatLng/unknown/conflict、loading/empty/error/expired/success、原生 listbox/radio、ARIA/focus/44px；匿名写与 direct POST 继续 fail closed。
- [ ] T-15 签名 Research Relay 与 Tabelog/预约 preview — Blocked by: T-13 — 实现 D-P06 `WebResearchPort` adapter：D1 先原子消费 phase allowance，Relay 经 protected Tunnel/auth 使用 OpenClaw search 仅产 URL candidate，并以自有 HTTPS:443 A+AAAA/IP-pin/SNI hardened transport 抓 canonical page；会话 preview 只接收闭合 scalar proposal，Catalog snapshot 必须等 T-16 Owner confirm。preflight/threat tests 覆盖 1 search/5 pages/60s 分阶段预算、无退款/自动 retry、allowance 篡改/过期/重放、response-loss 单次 egress、URL credentials/scheme/port/禁止地址/metadata/逐跳 redirect/DNS rebinding、零 raw/产品存储；任何保证失败即 Relay disabled、manual/unknown，启用前 D-P06 保持 Proposed。
- [ ] T-16 Atlas Catalog 原子 confirm/publish 五结果 — Blocked by: T-14 — 以 fixture `WebResearchPort` 独立实现深接口 `AtlasCatalogIntakePort.publish(preview,mutationKey,expectedSessionVersion,catalogRevision)`：同一 D1 transaction 重读/CAS session/revision/强 Place identity、执行 duplicate/verification/publication policy，并原子写 identity/item/snapshots/receipt/terminal。验收服务端 `add-confirm:v1` key、confirm refresh/new-preview conflict、180 天 receipt replay，以及 `committed_verified | committed_needs_review | reused_existing | conflict | failed_no_write`；needs_review 不进地图/Nearby，Add 不等待 channel event ID。
- [ ] T-17 Web confirm 与确定性 `/jpmap add` 双 adapter E2E — Blocked by: T-15, T-16 — Web Owner 与本地 OpenClaw adapter 共用同一 operations，完成 `/jpmap add <query> -> select <n> -> preview -> confirm|cancel`、recent receipt recovery 与 Web confirm/read-after-write；验收 Owner/匿名/第二账号/群聊/wrong scope/nonce replay、精确命令零模型调用、Web/Agent 等价及 verified 地点对地图/Nearby 可见。DeepSeek 模糊语义 proposal 仍属于 T-09，不是 Add PoC/T-17 验收前置。仅在全套负面门通过后本地 manifest 加四个 intake operations；遗留 `POST /api/items` 仍 503。
- [ ] T-18 Add production 蓝绿发布、切换与回退 — Blocked by: T-08, T-11, T-17 — 对 owner-poc append-only migration、Worker、Research Relay/Tunnel 和 OpenClaw manifest 执行 preflight、strict deploy、公开/Owner/Agent smoke、监控与回退演练；只有 D-P06 preflight/威胁评审通过才启用 Relay，否则以 manual/unknown 发布。生产 provider preflight 还必须证明 Google Places key 仅服务端可见且不进 log/DTO、API 已启用、key restriction、quota/billing cap、policy/attribution 回归，以及 DurableGeocoder 的 production identity、rate/cache/attribution、provider switch 和 `sourceUrl/license/checkedAt` provenance；任一条件失败即对应能力 fail closed，允许 Owner manual/needs_review，不阻塞基本 Add。验收旧 fixture 可读回退且新写不反迁、匿名/遗留 direct POST 失败关闭、Web/Agent 分别切换回退，并保存脱敏证据。
- [ ] T-19 Record 增量规格门 — Blocked by: None — 与用户冻结总体评论、逐图评分、别名/分店消歧和多段 inference；独立 spec/architecture review 通过前不实现 Agent Record。技术上可立即开始，但产品排期优先完成 Add PoC，并先与用户讨论 Record 细节。
- [ ] T-20 Record 统一 Personal Memory 发布 — Blocked by: T-19, feature004/T-20 VisitCapturePublisher — Web 与微信最终调用相同 Visit/assessment/media operations；验收稳定 channel event ID 幂等、R2 stage/promote、D1 原子可见、恢复、第二账号拒绝，以及总体/逐图评分和规范地点消歧，不继承 Add-only mutation key 例外。

## 并行与汇合

| 波次 | 可并行票 | 中央汇合 |
|---|---|---|
| W0 | T-01；T-02 可先用内存 adapter TDD | owner-poc bindings、seed manifest 与 public/auth policy |
| W1 | T-03、T-04、T-05 | Invocation/mutation coordinator、`AtlasApplication` 与 migration journal |
| W2 | T-06、T-10 | Route Sidecar/security review 与非 modal UI shell |
| W3 | T-07 | Nearby presenter 与 request-only 契约 |
| W4 | T-08、T-12 | Nearby E2E 与 Add walking skeleton 无共享阻塞，可并行 |
| W5 | T-09、T-11（T-08 后）；T-13（T-12 后） | Nearby/部署旧门与 Add persistent session 分别汇合 |
| W6（现在） | T-14、T-15 的 leaf adapter/provider contract tests（T-13 后） | leaf 可并行；共享 preview/session DTO、composition 与 migration 由中央串行汇合 |
| W7 | T-16（T-14 后）；T-15 中央集成 | 先稳定 durable preview/fixture research 的原子发布，再于 T-17 前串行合入真实 research |
| W8 | T-17 | 确定性 Web/Agent Add 本地双入口汇合 |
| W9 | T-18 | Add 生产 provider preflight、蓝绿切换与回退 |
| Deferred Record | T-19 无技术 blocker；T-20 在其真实依赖满足后 | 排期偏好为 Add PoC 后先讨论 Record 细节，不伪装成阻塞边 |

- 每张实现票使用红→绿→重构并经过独立 hf-review；UI 票必须包含真实截图评审。
- 并行作者不同时修改 `CatalogIntakeModule`、共享 preview/session DTO、`server-atlas-application`、operation catalog、migration journal、composition 或部署 config；T-14/T-15 只并行开发 leaf adapters 与 provider contract tests，这些共享面由中央按 T-14 → T-16 → T-15 integration 串行汇合，T-15 必须在 T-17 前完成。
- 任何真实 secret、用户给出的密码或 API key 都通过环境/Cloudflare Secrets provision，不写入票、fixture、日志或提交。
- GitHub #11 继续跟踪 Catalog 扩容后的本地坐标粗筛／Top-N，不阻塞 Add；GitHub #12 跟踪日本以外（中国大陆除外）的 Google external rating，不进入 T-12–T-18。
