# T-06A Google Geocoding v3 endpoint 修复代码评审（第 1 轮）

- 日期: 2026-09-17
- 评审方式: subagent
- 固定点: `HEAD`（`df2ec5958e974debca70b27b977662fd75cb7b87`；被评 Google provider/fixture/policy 主要为当前工作树未提交文件）
- 审查对象: `google-location-resolver.ts`、全部 resolver contracts/fixtures、T-06A nearby fixtures/provenance，以及 `google-2026-09-13.v1.json`
- 结论: 需修改

## Standards

- [一般] `features/004-openclaw-atlas-poc/evidence/provider-policies/google-2026-09-13.v1.json:1-96`: 该固定范围的 policy evidence 未通过 `oxfmt --check`。版本化 policy 是 adapter 的许可/activation 边界，不能以未格式化工件进入 review gate。→ 仅运行 formatter 修正该 JSON 的格式，随后由未参与修正者重新执行本轮 scoped format check；不改变 `pending_review`、origin、field permission 或 activation 内容。

## Spec

- 无一般或严重 finding。官方 Google Geocoding API v3 request 规定 `https://maps.googleapis.com/maps/api/geocode/{outputFormat}`；resolver 现在固定为 `GET https://maps.googleapis.com/maps/api/geocode/json`，与 D-P04 的闭合 tuple 和 policy `https://maps.googleapis.com` origin 一致。未发现遗留 `geocoding.googleapis.com` URL。
- Routes 未漂移：walking matrix 继续使用 `POST routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix`，walking/transit 继续使用 `POST routes.googleapis.com/directions/v2:computeRoutes`，均与 D-P04 allowlist 一致。
- `银座`、`銀座`、`ginza` 均保留为原样 encoded Location Hint，并固定 `region=jp` 与 `components=country:JP`；resolver contracts 覆盖三语、resolved/ambiguous/unresolved、malformed 与 gateway-failure fail-closed 行为。
- Google policy 仍为 `pending_review`，含正确的 maps/routes origins、request-only/no durable/no Leaflet field policy、Cloudflare secret location 与未满足的 activation evidence。固定范围仅构造 gateway request/fixture；未发现 `fetch`、真实 egress、credential 读取、部署或 D1/R2 写入。

## 验证记录

- 本人运行全部 Google provider、provider-policy 与 T-06A nearby fixture regressions：38/38 通过。所有 gateway/transport 均为本地 fake；没有真实 Google 请求、部署或凭证访问。
- 范围内 `oxlint` 通过；Google resolver、contracts、fixtures、T-06A nearby files的 `oxfmt --check` 通过。将 policy JSON 一并纳入 repository-root scoped formatter 后失败，形成上述 Standards finding。`git diff --check` 无空白错误。
- 独立查阅 Google 官方 v3 Geocoding request 文档，确认 hostname/path；并重读 feature 004 spec/architecture/tickets、先前 T-06A code review 与 D-P04 round 1/2 reviews。

## 结论说明

第 2 轮 D-P04 所指出的非官方 v3 hostname/path 已正确修复，且其实现、policy origin、Routes tuples、Japan bias 和未启用状态均保持闭合。当前唯一阻断为固定范围 policy JSON 的格式失败；修正格式后须复审，本轮不得 auto-approved。
