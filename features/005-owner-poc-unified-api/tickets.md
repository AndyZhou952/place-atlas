# 任务票 — Owner PoC 统一应用操作

- 状态：implement；第 2 轮独立代码评审与 owner-poc 远端基础部署 smoke 已通过；下一步 T-05，D-P05/T-06 安全门保持有效，当前不进入 ship/done
- 执行方式：垂直切片优先；中央 composition、migration journal 与 operation catalog 由主任务串行汇合
- 公开/权限确认：持 URL 者可查看 Catalog、总体评论、Visit 展示与照片原图；internal ID、存储 key、hash、audit 保持私有；只有 Owner 可以写入

## 第一门：网页可安全保存

- [x] T-01 owner-poc 蓝绿 schema 与 seed manifest 行走骨架 — Blocked by: None — 新的隔离 D1/R2/Worker 已 provision，旧资源保持不变；0001–0005 migrations、seed evidence、preflight、fresh placeholder 一次性 bootstrap 与最终 strict deploy 均通过，脱敏证据见 `evidence/deployment-smoke-2026-09-21.md`。
- [x] T-02 Public Read Manifest 与 OwnerCredential 行走骨架 — Blocked by: T-01 — 本地合同与远端 smoke 均通过：公开 Catalog/Journal 可读，鉴权先于 Application/R2，公开闭合 DTO/媒体流不泄漏 object key/filename/hash/internal ID/audit；匿名同源写入和错误登录 fail closed。
- [x] T-03 统一 InvocationContext、mutation receipt 与网页个人状态 — Blocked by: T-02 — 本地实现与验证完成：schema normalization 后计算 authoritative digest，Web 不提交 digest，原子 claim/write/receipt 覆盖 replay、conflict、并发 pending、lease takeover 与 response-lost retry。
- [x] T-04 Visit/媒体统一 mutation 与公开投影 — Blocked by: T-02, T-03 — 本地实现与验证完成：Visit/media 使用 Owner 门与统一 receipt，匿名媒体经 opaque display ID 读取，私有字段负测通过；Agent Record 仍未开放。

## 第二门：Web 与微信共享真实 Nearby

- [ ] T-05 渠道无关 Nearby operation 预重构 — Blocked by: T-01 — 用结构化 `nearby.recommend` 取代 owner-poc 中渠道专用 reply contract；Web 与微信 presenter 各自适配同一 result，删除 composition 对 `agent_catalog_items`/fixture personal facts 的依赖。保留兼容 adapter 直到 contract tests 全绿。
- [ ] T-06 独立 Google Route Sidecar 与双 hard cap — Blocked by: T-01, T-05 — Sidecar 设置 `workers_dev=false` 且无 routes/owner bindings，只经窄 service binding 接受 typed request；preflight 负测公网 URL 不可达、未绑定 Worker 不可调用。按 provider+SKU+UTC period 预留 8,000 Geocoding requests/月与 8,000 walking elements/月，失败不退款；Transit/Foursquare 零调用，独立评审前 fail closed。
- [ ] T-07 Web/Agent/Sidecar 等价与 request-only 契约 — Blocked by: T-03, T-05, T-06 — 同一 Catalog、个人事实与位置文字分别通过 browser adapter 与 HMAC gateway，断言候选、路线层、到访/评分、warning 与 attribution 等价；证明 Sidecar 原始 JSON、地址/坐标/路线不进入 D1/R2/log/prompt/Leaflet，并验证公开 ToS/Privacy probe。
- [ ] T-08 确定性 `/jpmap nearby` owner-poc E2E — Blocked by: T-07 — 精确命令零模型调用，覆盖 `银座/銀座/ginza`、owner DM、第二账号、群聊、错误 scope、nonce replay 与 Worker audit；旧 fixture 保持可回退。

## 第三门：语义辅助与发布

- [ ] T-09 受限 DeepSeek semantic proposal — Blocked by: T-08 — 在项目与 phase allowlist 已确定后，允许模型把模糊位置文字翻译为 schema 受限 proposal；拒绝模型提供的 operation、权限、坐标、路线与评分事实。模型失败时精确 `/jpmap` 命令继续可用。
- [x] T-10 非 modal Owner Login UI 真实渲染门 — Blocked by: T-03 — 本地 UI 门与远端 smoke 均完成；用户已确认 Owner 登录以及总体评论、喜欢、去过状态的写入与读回。体感写入延迟另由 GitHub #10 跟踪。
- [ ] T-11 双入口蓝绿部署与回退演练 — Blocked by: T-04, T-07, T-08, T-10 — 新 Web Worker 的 strict deploy、公开/Owner smoke 与 AWS signed Agent 正负 probe 已完成；但 T-05–T-08 尚未完成，永久 OpenClaw endpoint 切换及其回退演练仍未执行，因此不得标记完成。

## 后续受门禁约束的共享写入

- [ ] T-12 Add discover/select/preview 统一 operation — Blocked by: T-08, feature004/T-11 provider decision — 将已评审 `CatalogIntakeCoordinator` 注册为渠道无关 operations；Web 与 `/jpmap add` 共用 candidate/preview，不暴露底层 Catalog write，单候选也不自动保存。在此票完成前，owner-poc 的 `POST /api/items` 有意返回 503 fail closed，不允许绕过统一 coordinator。
- [ ] T-13 Add confirm 原子写与双端可见 — Blocked by: T-12, feature004/T-10 stable event ID — 复用 feature004 的 evidence/revision/strong identity/mutation receipt 约束，以单一 D1 transaction 发布到 `atlas_items`；确认后 Web 地图和 Agent 立即读取同一 item。
- [ ] T-14 Record 增量规格门 — Blocked by: T-11 — 与用户冻结总体评论、逐图评分、别名/分店消歧和多段 inference；独立 spec/architecture review 通过前不实现 Agent Record。
- [ ] T-15 Record 统一 Personal Memory 发布 — Blocked by: T-13, T-14, feature004/T-20 VisitCapturePublisher — Web 与微信最终都调用相同 Visit/assessment/media operations；验证事件幂等、R2 stage/promote、D1 原子可见、恢复和第二账号拒绝。

## 并行与汇合

| 波次 | 可并行票 | 中央汇合 |
|---|---|---|
| W0 | T-01；T-02 可先用内存 adapter TDD | owner-poc bindings、seed manifest 与 public/auth policy |
| W1 | T-03、T-04、T-05 | Invocation/mutation coordinator、`AtlasApplication` 与 migration journal |
| W2 | T-06、T-10 | Route Sidecar/security review 与非 modal UI shell |
| W3 | T-07、T-09 | operation catalog、Agent manifest 与 presenter |
| W4 | T-08、T-11 | Web 与 OpenClaw 两入口独立 E2E/切换/回退 |
| Later | T-12/T-13；T-14 后 T-15 | Add/Record 独立门 |

- 每张实现票使用红→绿→重构并经过独立 hf-review；UI 票必须包含真实截图评审。
- 并行作者不同时修改 `server-atlas-application`、operation catalog、共享 migration journal 或部署 config；这些文件由中央汇合票统一处理。
- 任何真实 secret、用户给出的密码或 API key 都通过环境/Cloudflare Secrets provision，不写入票、fixture、日志或提交。
