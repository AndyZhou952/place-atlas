# 004 D-P04 Google 固定 origin egress 架构增量评审（第 2 轮）

- 日期: 2026-09-15
- 评审方式: subagent
- 审查对象: 修订后的 D-P04 proposed decision 及其 `architecture.md` 增量
- 结论: 需修改

## 审查证据

- 独立重读 `hf-review`、design checklist、feature 004 `spec.md`／`architecture.md`／`progress.md`、`CONTEXT.md`、`product/architecture.md`、D-P03/D-P04 与第 1 轮评审；未修改被评设计。
- 第 1 轮 endpoint-boundary finding 已关闭：D-P04 与架构现在一致地列出三条闭合 tuple，规定未列 host/port/path/method 在 egress 前失败关闭，并要求三条正测及 host、port、path、method 的负测。
- 偏离仍被诚实标记为不提供逐 DNS／IP pin 的受限 PoC 例外；adapter 不接受 URL、redirect 全拒绝、用户／模型／provider 数据不能影响 endpoint、其他 provider/返回 URL 保持原 `ProviderPolicyGateway` DNS/IP/redirect 契约并在不能满足时 fail closed。secret、字段许可、quota、request-only、原始响应 mapper、B/C 回退与接受/重审门均保持闭合。

## 发现项

- [一般] `docs/decisions.md:203`、`features/004-openclaw-atlas-poc/architecture.md:55`: 新列出的 Geocoding tuple 是 `GET https://geocoding.googleapis.com:443/maps/api/geocode/json`，但 Google 官方 v3 Geocoding request 定义的该 path 使用 `https://maps.googleapis.com/maps/api/geocode/json`，而 v4 使用 `https://geocode.googleapis.com/v4/geocode/address...`；已列 tuple 把非该 v3 API 的 hostname 与 v3 path 组合，无法证明为预批准的官方 endpoint，也会使所谓正向 contract test 锁定一个不正确的调用。→ 选择一个受支持的 API version，并把 hostname/path、credential/header style、允许 query schema 与字段许可一并固定为其官方契约；相应更新三元组正测。参考 [Google Geocoding API v3 request](https://developers.google.com/maps/documentation/geocoding/guides-v3/requests-geocoding) 与 [Geocoding API v4 request](https://developers.google.com/maps/documentation/geocoding/geocoding)。

## 结论说明

第 1 轮唯一 finding 已修复，但新 tuple 的官方 endpoint 不正确，故仍不能通过设计质量门。D-P04 仍是 **Proposed（待用户确认）**；本评审不表示用户确认或 Accepted，不授权启用 provider policy、部署或使用真实凭证。修正后应再次进行独立复审。
