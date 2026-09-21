# Feature 004 第一／二阶段切片代码评审（第 3 轮）

- 日期: 2026-09-13
- 评审方式: subagent
- 固定点: `HEAD df2ec5958e974debca70b27b977662fd75cb7b87`
- 范围: T-01/T-02/T-05/T-06/T-07/T-08、T-03 本地部分、T-11 离线部分；排除 feature003、线上部署与真实供应商启用
- 结论: 通过
- auto-approved 2026-09-13

## Standards

无严重或一般发现。

前两轮 Standards 修复无回归：`agent.nearby` 仍由中央 `AtlasApplication` 静态 catalog 组合，定向架构门仍会拒绝未组合的 operation group；provider 地址分类、D1 mutation claim/receipt、审计 key ID 脱敏与单一距离 policy 的相关聚焦契约全绿。本轮新增的路线新鲜度与位置 provenance 字段集中在已有领域类型和 adapter 边界，未引入平行入口或新的跨层依赖。

## Spec

无严重或一般发现。

第二轮两项 Spec 发现已关闭：

- 路线证据已闭合为 `fresh | stale | unavailable`。`NearbyRecommendation` 以注入 clock 和最大年龄判定本请求证据；时间过旧、未来、非法时都降级为 `stale`，不能进入步行候选或直达电车候选。降级结果只能以直线距离候选呈现，并带有未核验路线的 warning；walking 证据还在 outcome 中保留明确的 stale/invalid warning。
- `LocationResolution` 在 `resolved` 和 `ambiguous` 中必须携带 provenance，`unresolved` 在实际收到可审计 provider 结果时也携带。`providerId`、`policyVersion` 和 request-specific `sourceUrl` 直接取自本次 `ProviderPolicyGateway` 成功结果，`checkedAt` 由 adapter 在该调用成功返回后立即用注入 clock 产生。唯一候选、歧义候选、零候选的 contract 及最终微信回执都展示来源 URL、核验时间和 provider/policy 版本；网关失败时不伪造 provenance。

## 验证证据

- 通过：本人重跑签名网关、命令路由、完整 Nearby、Google/Foursquare adapter、ProviderPolicyGateway、EntryAccess、Agent-PoC build/preflight 共 71/71 项聚焦测试。
- 通过：定向架构门 1/1，未组合进中央 catalog 的 operation group 仍被拒绝。
- 通过：`git diff --check`。
- 范围备注：T-03 真实 Cloudflare 资源／Secrets／部署证据与 T-11 实际 Foursquare API agreement／字段许可／日本样本校准仍是既有外部门，本轮不将其误判为本地代码缺陷。
