# 任务票 — Owner PoC 统一应用操作

- 状态：T-17 已独立评审、用户确认并合入；T-18 Worker/OpenClaw 生产切换、live durable-geocoder 与回退演练已完成，现等待真实微信 DM 和 Google Console 安全／成本门
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
- [ ] T-08 确定性 `/jpmap nearby` owner-poc E2E（代码门与主机 signed probes PASS，待真实微信 DM 验收）— Blocked by: T-07 — OpenClaw 0.3.0 已切换 owner endpoint 并重启；零模型 probes 覆盖 `银座/銀座/ginza`、第二 sender、thread/group、错误 actor/tool scope 与 nonce replay，旧 endpoint rollback→restore 通过。仍需 Owner 从真实微信 DM 发出命令并确认 connector delivery 后才能关闭；本地坐标粗筛／Top-N 性能优化继续由 GitHub #11 跟踪，不阻塞本票。

## 第三门：语义辅助与发布

- [ ] T-09 受限 DeepSeek semantic proposal — Blocked by: T-08 — 在项目与 phase allowlist 已确定后，允许模型把模糊位置文字翻译为 schema 受限 proposal；拒绝模型提供的 operation、权限、坐标、路线与评分事实。模型失败时精确 `/jpmap` 命令继续可用。
- [x] T-10 非 modal Owner Login UI 真实渲染门 — Blocked by: T-03 — 本地 UI 门与远端 smoke 均完成；用户已确认 Owner 登录以及总体评论、喜欢、去过状态的写入与读回。体感写入延迟另由 GitHub #10 跟踪。
- [ ] T-11 双入口蓝绿部署与回退演练 — Blocked by: T-04, T-07, T-08, T-10 — 新 Web Worker 的 0% override、100% promotion、post-secret 正确旧版本实际 rollback/green restore，以及 OpenClaw endpoint rollback/restore 均已完成；公开/Owner/host signed smoke 通过。仅因 T-08 真实微信 connector 演示尚未验收而保持未勾选。

## 后续受门禁约束的共享写入

- [x] T-12 Add CatalogIntake walking skeleton 与闭合 contracts（第 3 轮 code-review PASS；用户于 2026-09-22 确认）— Blocked by: T-03 — 原地深化 `catalog-intake-coordinator.ts` 为 Application Operations 的 `CatalogIntakeModule`，注册 `catalog.intake.discover/select/confirm/cancel` 闭合 input/output/error 与内存 fixture ports；迁移遗留 full-evidence 测试到 `AtlasApplication catalog.intake.*` 和 provider contract tests，删除旧 session/map evidence persistence，证明无平行 coordinator、Foursquare/底层 save/update/delete/direct POST 旁路且 `POST /api/items` 仍 503。验收证据：完整测试 479/479、聚焦 contract 10/10；用户确认后进入 T-13。
- [x] T-13 持久 session/CAS 与 transient Google discover/select（第 2 轮 code-review PASS；用户于 2026-09-22 确认）— Blocked by: T-12 — append-only D1 session/CAS、30 分钟 inactivity TTL、180 天 terminal/request retention、Google Top-3 transient projection 与 owner-poc daily cleanup 均已完成；并发续期不会被误报过期或被清理误删。验收证据：聚焦 contracts 27/27、完整测试 496/496、TypeScript、lint、format-check、diff-check 与 owner-poc production build 全部通过。
- [x] T-14 durable geocoder、only-name 与可访问 Web preview（第 2 轮独立 code/UI review PASS；用户于 2026-09-23 确认）— Blocked by: T-13 — 已接入可替换 `DurableGeocoderPort`，以 Owner query/draft 形成 title/address/location proposal；PoC Nominatim offline adapter contracts 满足直接用户触发、official endpoint、全应用 D1 原子 <=1 req/s、有效 UA/Referer、cache、OSM attribution、禁止 expanded/private input 与 autocomplete/systematic/details scraping，失败保留 Owner 输入并形成 needs_review preview。四个 Owner-cookie Web routes 与 browser adapter 复用 operations；聚焦 tests 14/14、完整测试 515/515、TypeScript、lint、format-check、diff-check、owner-poc build 与 migration-check 全部通过。Web panel 覆盖 only-name/追问、provenance/LatLng/unknown/conflict、loading/empty/error/expired/success shell、原生 radio、ARIA/focus/44px；关闭 collection 时以 `inert` 隔离隐藏控件。Web conversation 由签名 Owner session 服务端派生，伪造 ID 被替换或拒绝；anonymous/direct POST 继续 fail closed。1440×1107 desktop、390×1038 mobile 与标准 401 Owner-login state 已用临时 Chromium 目视通过，401 后 Owner 输入保持。owner-poc production provider/composition wiring 留到 T-18。
- [x] T-15 签名 Research Relay contract/security slice 与 Tabelog/预约 preview（最终独立 code/security review PASS；用户于 2026-09-23 确认）— Blocked by: T-13 — D1 原子消费并绑定 session/scope/version/state/exact TTL/权威 digest 的 phase allowance；签名 allowance/result、跨进程 replay guard、response-loss 单次 egress、闭合 scalar/usage、raw 零产品存储，以及 HTTPS:443、A+AAAA、IP pin、原 hostname SNI/Host、逐跳 redirect 与 DNS rebinding 防线均已实现并通过评审。验收证据：focused contracts 92/92、完整测试 601/601，TypeScript、lint、format、migration、diff 与 owner-poc production build 全绿；记录见 `reviews/t15-code-security-review-2026-09-23.md` 与 `reviews/t15-demo-acceptance-2026-09-23.md`。D-P06 仍为 Proposed：真实 Node/OpenClaw/Tunnel adapter、身份／Secret／host preflight 和真实负向 probes 留给 T-18；在此之前 production Relay 默认关闭，Tabelog／预约回退 Owner 手填或 unknown。
- [x] T-16 Atlas Catalog 原子 confirm/publish 五结果（第 7 轮独立 code/UI review PASS；用户于 2026-09-23 确认）— Blocked by: T-14 — `AtlasCatalogIntakePort.publish` 已在单一 D1 transaction 内重读并 CAS session/full preview/digest/exact TTL、Catalog revision、scope 与强 Place identity，原子提交 identity、verified item 或 Owner-only Review Candidate、精确 evidence、receipt 与 terminal；覆盖服务端 `add-confirm:v1` key、同 key 并发、response-loss replay、180 天 receipt 清理、save/update/delete race 与五路结果。Review Candidate 可进行 Owner Visit 生命周期，但不进匿名 Catalog、personal/media display、地图或 Nearby；双 provider 部分失败可终止且不伪造 observation time。验收证据：changed/new focused 144/144、架构与边界 64/64、完整测试 564/564、TypeScript/lint/format/migration/diff 与 owner-poc build 全部通过。真实 UI 截图因评审环境无浏览器而保留为非阻断 evidence gap；T-18 前 production composition/deploy 仍 fail closed。
- [x] T-17 Web confirm 与确定性 `/jpmap add` 双 adapter E2E（第 3 轮独立 code/UI review PASS；用户于 2026-09-24 确认）— Blocked by: T-15, T-16 — Web Owner-cookie 与 signed Agent HMAC 在同一真实 D1 fixture 上复用 `catalog.intake.discover/select/confirm/cancel`，覆盖 verified 与 needs-review、conflict 显式二次确认、recent committed receipt recovery、cancel replay、Owner/匿名/第二账号/群聊/wrong scope/nonce replay、零模型精确命令、公开 Catalog/地图/Nearby read-after-write 与 Owner-only Review Candidate。Owner manifest 只增加四个 intake operations，audit/dispatch 直接使用 manifest `tool.operation`；遗留 `POST /api/items` 继续 503。验收证据：architecture fitness 62/62、T-17 focused 10/10、OpenClaw plugin/src-dist、TypeScript/lint/format/migration/diff 全绿；10 张真实 Chromium production React 截图及 ARIA/focus/computed CSS 通过。D-P06 仍 Proposed，Relay 继续 disabled/manual-unknown；DeepSeek 模糊语义仍属于 T-09。
- [ ] T-18 Add production 蓝绿发布、切换与回退（现场执行完成，待微信/Google Console 最终验收）— Blocked by: T-08, T-11, T-17 — owner-poc `0006`–`0009`、Places Secret、fresh seed/preflight、Worker canary/promotion/rollback、公开/Owner Add、OpenClaw 0.3.0 switch/restart/signed probes/rollback 均已完成，脱敏证据见 `evidence/t18-production-rollout-2026-09-24.md`。Deployment preflight 已证明 durable-geocoder mode 启用；本次 pinned/reviewed release 包含固定 Nominatim identity、D1 全局 1 req/s、30 天 cache、provider replacement seam 及 `sourceUrl/license/checkedAt` contracts。歧义/无单一匹配输入按设计返回 unknown/clarification；公开单一匹配 `東京タワー` 的 live select 已返回 known durable-geocoder evidence，OpenStreetMap source、license、checkedAt 均有效，随后 cancel 且未发布测试 item。Research Relay 因 D-P06 仍 Proposed 而保持 `relay_disabled_manual_unknown`。剩余门为真实 Owner 微信 DM connector delivery，以及 Google Places key application restriction、provider quota、budget alert（或经确认的正式补偿控制）证据；完成前不得勾选。
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
| W6 | T-14、T-15 的 leaf adapter/provider contract tests（T-13 后） | leaf 可并行；共享 preview/session DTO、composition 与 migration 由中央串行汇合 |
| W7 | T-16（T-14 后）；T-15 中央集成 | 先稳定 durable preview/fixture research 的原子发布，再于 T-17 前串行合入真实 research |
| W8（现在） | T-17 | 确定性 Web/Agent Add 本地双入口汇合 |
| W9 | T-18 | Add 生产 provider preflight、蓝绿切换与回退 |
| Deferred Record | T-19 无技术 blocker；T-20 在其真实依赖满足后 | 排期偏好为 Add PoC 后先讨论 Record 细节，不伪装成阻塞边 |

- 每张实现票使用红→绿→重构并经过独立 hf-review；UI 票必须包含真实截图评审。
- 并行作者不同时修改 `CatalogIntakeModule`、共享 preview/session DTO、`server-atlas-application`、operation catalog、migration journal、composition 或部署 config；T-14/T-15 只并行开发 leaf adapters 与 provider contract tests，这些共享面由中央按 T-14 → T-16 → T-15 integration 串行汇合，T-15 必须在 T-17 前完成。
- 任何真实 secret、用户给出的密码或 API key 都通过环境/Cloudflare Secrets provision，不写入票、fixture、日志或提交。
- GitHub #11 继续跟踪 Catalog 扩容后的本地坐标粗筛／Top-N，不阻塞 Add；GitHub #12 跟踪日本以外（中国大陆除外）的 Google external rating，不进入 T-12–T-18。
