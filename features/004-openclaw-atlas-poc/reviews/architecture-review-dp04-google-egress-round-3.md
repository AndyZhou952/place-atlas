# 004 D-P04 Google 固定 origin egress 架构增量评审（第 3 轮）

- 日期: 2026-09-17
- 评审方式: subagent
- 审查对象: 修订后的 D-P04 proposed decision、feature 004 architecture 增量及其现有 provider-policy/adapters 一致性
- 结论: 通过

## 审查证据

- 独立完整阅读 `hf-review`、design checklist、`product/architecture.md`、feature 004 `spec.md`／`architecture.md`、D-P04、第 1/2 轮评审，以及现有 `ProviderPolicyGateway`、Google resolver/Routes adapters 与 policy evidence；未修改被评设计。
- 独立核对官方文档：v3 Geocoding tuple `GET https://maps.googleapis.com:443/maps/api/geocode/json`、Route Matrix `POST https://routes.googleapis.com:443/distanceMatrix/v2:computeRouteMatrix` 与 Compute Routes `POST https://routes.googleapis.com:443/directions/v2:computeRoutes` 均与 Google REST 文档一致；Cloudflare Request 文档也证实外部 Google hostname 不可借 `resolveOverride` 获得已验证 IP pin。
- 当前 Google adapters 使用上述相同的代码拥有 URL；Google policy evidence 仍为 `pending_review`，而通用 `ProviderPolicyGateway` 继续对非例外 provider 逐 redirect 重验 origin/DNS/public unicast 并在失败时关闭。没有发现已启用的 D-P04 transport、真实凭证或绕过 policy 的组合。
- 本人运行 21 个本地 provider-policy／Google adapter contract tests，全部通过；其中覆盖 request-only、字段/attribution、policy pending、quota/cost、DNS 私网/混合答案、逐跳 redirect 与 Google route/geocoding adapter 行为。未发起外部 provider 请求。

## 发现项

- 无。

## 第 1/2 轮发现关闭

- 第 1 轮的闭合 endpoint 边界已关闭：D-P04 与 `architecture.md` 同步列出三个 `(method, origin, port, path)` tuple，未列 host/port/path/method 均在 egress 前 fail closed，并要求正测及每类变体负测。
- 第 2 轮的 Geocoding hostname/path 不匹配已关闭：v3 tuple 改为 `maps.googleapis.com` 加 `/maps/api/geocode/json`，且与现有 resolver 和 Google 官方 v3 request 契约一致。

## 结论说明

该增量仍明确是相对 feature spec 逐 DNS／IP pin 契约的**受限偏离**，而不是等价实现：只覆盖隔离、只读 Nearby PoC 的固定 Google transport；不接收 URL、用户/模型/provider 数据不能影响 endpoint、所有 redirect 拒绝、secret 只在最终 transport 注入、原始 JSON 只经字段许可 mapper、Google 内容 request-only。其他 provider、返回 URL 与未来任意 URL fetch 继续受完整通用 gateway 契约约束，不能满足即 fail closed。B/C、接受条件与重新比较门均保留；设计没有预建通用 egress/proxy 抽象。

D-P04 仍为 **Proposed（待用户确认）**。本评审只表示设计质量通过，不构成用户确认、不将其标记为 Accepted，也不授权启用 provider policy、部署或使用真实凭证。
