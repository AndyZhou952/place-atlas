# Feature 004 第一／二阶段切片代码评审（第 1 轮）

- 日期: 2026-09-13
- 评审方式: subagent
- 固定点: `HEAD df2ec5958e974debca70b27b977662fd75cb7b87`
- 范围: T-01/T-02/T-05/T-06/T-07/T-08、T-03 本地部分、T-11 离线部分；排除 feature003、线上部署与真实供应商启用
- 结论: 需修改

## Standards

- [严重] `apps/web/scripts/architecture-fitness.ts:417-428`、`apps/web/product/application/architecture-fitness.test.mjs:1852-1859`、`apps/web/adapters/agent/isolated-readonly-agent-service.ts:51-55`: 新增的 `isolatedOperationGroupOwners` 只调用 `evaluateGroup()` 就把 group/definition 标为 reachable；它没有要求 operation 进入中央 catalog，也没有阻止另建 `AtlasApplication`。当前 `agent.nearby` 正是由隔离 service 创建第二个 application，并未加入生产 `expectedOperationKeys`，因此适应度门被放宽到允许违背“唯一 AtlasApplication 产品入口”的实现。→ 将 `agent.nearby` 合入中央 server composition 与 expected catalog；若确需第二实例，先修改已确认架构/ADR，并让适应度函数直接证明新的唯一性与调用边界，不能用 owner allowlist 消除 unowned 诊断。
- [严重] `apps/web/product/provider-policy/provider-policy-gateway.ts:321-379`: 自写 IP 分类器没有识别十六进制 IPv4-mapped IPv6；实测 resolver 返回 `::ffff:7f00:1` 时 transport 被调用并得到 `ok: true`，可绕过 loopback/SSRF 禁令。它也没有完整拒绝 multicast/unspecified/reserved 等非全球可路由地址。→ 使用经过验证的 IP parser/classifier，把 dotted/hex IPv4-mapped IPv6 先规范化为 IPv4，并以“仅允许 globally routable unicast”白名单判定；补齐每类等价编码、混合 DNS 结果与 redirect 每跳测试。
- [一般] `apps/web/product/application/conversation/agent-service-gateway.ts:254-305`、`apps/web/adapters/agent/d1-agent-gateway-adapters.ts:66-113`: receipt 采用 `find → 执行 provider → INSERT`，不是原子 claim/commit。两个使用不同 nonce 的同 mutation 并发请求都能执行 provider；第二个随后撞 D1 主键并返回 `unexpected_failure`，既不回放 receipt，也没有该请求的最终审计。现有 fake D1 在重复键时直接覆盖，掩盖了真实约束。→ 把 mutation claim、payload digest 比较和 receipt 读取做成 D1 原子协议；唯一冲突后重读并回放同 digest、不同 digest 返回 conflict，并增加真实唯一约束语义的并发测试。
- [一般] `apps/web/product/application/conversation/agent-service-gateway.ts:360-370`、`:604-621`: 非法 `x-atlas-key-id` 虽被拒绝，却原样写入 authentication audit；超长、控制字符或私人文本可污染审计表，违反结构化标识与最小日志原则。→ 只有通过 bounded identifier 校验的 key ID 才记录原值，否则记录固定 `unknown` 或不可逆短摘要；增加控制字符和超长 header 的审计测试。
- [一般] `apps/web/product/application/decision/nearby-recommendation-operation.ts:145-156` 与 `apps/web/product/application/decision/decision-operations.ts:158-173`: Haversine 距离策略被复制为第二份实现，后续半径、地球半径或数值边界修改会霰弹式漂移。→ 提取一个 Decision Support 内唯一的地理距离 policy，并让旧 `decision.nearby` 与新 NearbyRecommendation 共用。

## Spec

- [严重] `apps/web/product/application/conversation/project-command-router.ts:8-27,160-175`、`apps/web/product/application/decision/nearby-recommendation.ts:116-133`、`apps/web/product/application/decision/nearby-result-presenter.ts:26-161`: 实际 Agent operation 仍使用 T-01 的旧简化结果（强制 `walkingMinutes`），formatter 只输出步行/到访布尔/地址/理由/地图。T-06/T-07 的 `ambiguous | unresolved | distanceCandidates | directTransitCandidates` 和 T-08 的 EntryAccess、预约、个人/外部评分、来源/时间/warning presenter 均是未接入的孤立模块；因此签名 HTTP/微信主链无法交付已勾选票的行为，且距离/电车候选甚至无法通过旧 schema。→ 用一个 `agent.nearby` application operation 组合 LocationResolver、NearbyRecommendation、最终候选 EntryAccess enrichment、个人/外部事实投影和 presenter；删除旧平行 DTO/formatter，并新增从签名 HTTP 到完整三层回执的 contract test。
- [严重] `features/004-openclaw-atlas-poc/evidence/provider-policies/google-2026-09-13.v1.json:6` 对路线登记 `routes.compute`，但 `apps/web/adapters/providers/google-walking-route-provider.ts:22-25` 与 `google-transit-route-provider.ts:22-25` 请求 `routes.read`。policy 激活后两种路线都会被 fail-closed gateway 拒绝，15 分钟步行和 20 分钟直达无法工作。→ 将 scope 收敛为一个共享的类型化常量并让 policy、credential 配置、两个 adapter 与 contract fixture 使用同一值；加“真实 policy document + adapter request”契约测试，避免各自 mock 掩盖错位。
- [一般] `apps/web/adapters/providers/google-transit-response-mapper.ts:22-55`: “门到门时长”由各 step 的 `staticDuration` 相加得到，没有读取/校验 Google 的 route/leg 总 duration；fixture 也没有站内等待或班次等待差额。该值可能低估用户真正需要的门到门时间，却被用来通过 20 分钟硬门。→ 以 provider 的 route/leg 总 duration 作为门到门权威值，steps 只用于 boarding/line/transfer 判定；增加总 duration 大于 step 合计及 20:00/20:01 的 fixture。
- [一般] `apps/web/product/application/decision/nearby-recommendation.ts:14-34,40-73`、`apps/web/adapters/providers/google-location-resolver.ts:43-67`、`apps/web/product/application/decision/nearby-result-presenter.ts:43-58`: LocationResolution 没有来源 URL/核验时间，完整 presenter 也没有 resolution attribution 字段；距离 fallback 或地址歧义场景会展示 Google 派生地址而无法就近标注 Google Maps。→ 把 resolution provenance/attribution 纳入统一 outcome 和所有 resolved/ambiguous 回执；为无 route、歧义候选和 dependency fallback 增加 attribution contract test，并保持 Google 内容不进入 Leaflet/持久存储。
- [一般] `apps/web/product/application/decision/nearby-recommendation.ts:40-73`: 路线证据类型只有 `fresh | unavailable`，没有规格要求的 `stale`；旧证据无法被类型化为 stale 并携带明确 warning。→ 补齐三态 contract；只有本请求现场成功可转为 fresh，任何带旧时间的证据必须 stale 且不能支持分钟数/直达断言。
- [一般] `apps/web/product/application/decision/entry-access-nearby-decorator.ts:57-123,138-166`: `confirmed`、`reservation_required`、`none_reported` 与 `waiting_reported` 只要求任意非空 `sourceUrl/checkedAt`，没有验证允许来源、HTTPS、时间格式或当前请求新鲜度。供应商若返回过期/未来字符串，仍会被展示为“当前无需排队/可直接到店”。→ 让 EntryAccess adapter 通过 ProviderPolicyGateway 产生带 policy version 的断言，并在边界以注入 clock 验证 HTTPS、允许 provenance 与新鲜窗口；不满足即分别降级 unknown，补过期/未来/非法 URL 测试。

## 验证证据

- 通过：Agent gateway/command/provider-policy 聚焦测试 19/19。
- 通过：Nearby/EntryAccess/presenter/Google adapter 聚焦测试 23/23。
- 通过：T-03 本地部署/成本/build-target 聚焦测试 17/17。
- 通过：T-11 离线 Foursquare 测试 4/4；policy 仍为 `pending_review`，未发生网络调用。
- 通过：新增 architecture-fitness 定向测试 1/1；但该测试证明的是被本评审判为不符合已确认架构的放宽行为。
- 通过：评审范围 TypeScript file-scoped `tsc`；范围内 source-only `oxlint`；`git diff --check`。
- 未通过（不归因于本切片）：全仓 `npm run typecheck` 被 feature003 的 `scripts/migration-packaging.ts:81,124` 两个既有 Buffer 类型错误阻断；全仓 lint 还包含仓库广泛既有的 Node test `no-floating-promises` 报告。architecture-fitness 全套运行超过 4 分钟无 TAP 子结果后终止，已单独重跑本轮新增用例。
