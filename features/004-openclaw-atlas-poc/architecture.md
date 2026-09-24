# 架构 — 004 OpenClaw × Japan Atlas PoC

- 日期：2026-09-13
- 对应规格：[spec.md](./spec.md)
- 用户确认：2026-09-13（record 的逐图细分评分与非规范店名解析在实现前另过规格细化门）

## 1. 对齐与部署边界

- 遵守模块化单体、Ports & Adapters、唯一 `AtlasApplication` 产品入口和无环依赖；供应商/渠道 SDK 只在 adapters。
- Cloudflare 隔离环境部署静态前端、Worker API、D1、R2；Lightsail 只运行 OpenClaw、微信 adapter、入站路由和项目 client，可独立迁往 Hetzner/OCI。
- 不接触 Sites 生产数据或 feature 003；私有写入、鉴权和媒体不放 GitHub Pages、iCloud 或 Google Drive。

## 2. 深模块与依赖

| 模块 | 公开接缝 | 隐藏的复杂性 |
|---|---|---|
| `PreModelIngressRouter` | `route(envelope)` | capability gate、严格 alias、防火墙、capture lookup 与 fail-closed |
| `ProjectCommandRouter` | `dispatch(command)` | 闭合语法、registry、凭证/scope、固定错误与零模型分发 |
| `AgentServiceGateway` | `handle(signedRequest)` | HMAC、nonce、owner/channel、schema、审计与脱敏 |
| `AgentToolCatalog` | `manifest(project, phase)` | 静态 operation descriptors、effect/scope/confirm/retry 与 phase allowlist |
| `CatalogIntakeCoordinator` | `handle(event)` | discovery、强身份/疑似重复、immutable evidence、preview/revision |
| `VisitCaptureCoordinator` | `handle(event)` | 状态表、附件暂存、顺序/重复、预览、恢复与确认 |
| `VisitCapturePublisher` | `publish(preview, mutationId)` | 全组可见性、稳定 ID、receipt、recovery/abandon/reconcile |
| `NearbyRecommendation` | `execute(query)` | 位置三态、硬筛选、路线分层、稳定排序与未知事实 |
| `ProviderPolicyGateway` | `invoke(request)` | origin/DNS/redirect/字段许可、缓存、配额和条款 |

`Channel adapter → PreModelIngressRouter/ProjectCommandRouter → Coordinators → AtlasApplication → Catalog/Personal Memory/Decision Support → ports`；只允许该方向。Catalog 独占 verified/abstain；两个 coordinator 不直接写 D1/R2。规格测试缝一一对应 Router、Gateway、CatalogIntakeCoordinator、VisitCaptureCoordinator/Publisher、NearbyRecommendation。

## 3. 权威状态与入口路由

- D1 是 channel event、nonce、intake/capture session、preview、mutation/receipt 和业务记录的权威源；R2 只有 staged/live 媒体对象。
- 任一可能进入模型的普通文字/图片前，Lightsail 以签名 `CaptureRouteLookup(actor, channel, conversation)` 取得 session ID/state/version/expiry。明确 `none` 才可进入普通助手；超时、stale、歧义或网络错误固定拒绝且不进模型、不改草稿。
- 可缓存的 lookup 必须是服务端签名的短期断言，状态转移主动失效；重启、切换竞态、缓存过期和网络分区均用真实微信链路验证。
- canonical `/jpmap` 走 OpenClaw 原生 plugin command，在 agent/model loop 前按 raw args 分发且不注册模型 tool；平台 auth 后仍精确绑定 sender、`openclaw-weixin` channel、direct from/to 与无 thread，再以项目独立 key/scope 调用 Worker。bare alias/capture 仅在 pre-model probe 通过后开 gate；普通模型无项目凭证。

## 4. 工具面、签名与幂等

- `AgentToolCatalog` 是唯一 Agent manifest 投影，不复用 browser capability 清单；read 阶段只含 nearby，write 阶段只增 intake/capture，默认拒绝 destructive、maintenance、reset、底层 save/update/delete，隐藏 key 也不能直接调用。
- 签名 canonical bytes 固定为 method、规范 path/query、原始 body digest、timestamp、nonce、key ID；常量时间比较，窗口 ≤5 分钟，nonce 按 `(projectId,keyId,nonce)` 唯一且保留超过窗口。
- 传输重试使用新 nonce、同一 mutation ID；业务层以 canonical payload digest 回放同一 receipt，不同 digest 返回 conflict。Lightsail secret 只在 service-identity-only secret store：系统级 systemd 使用 root-owned，当前 user-level systemd 使用受保护目录内的 service-account-owned `0600` 文件，不对组或其他用户开放。Worker secret 只在 Cloudflare Secrets，D1 仅存 key metadata。
- key 轮换允许短 overlap，随后撤销旧 key；contract tests 覆盖时钟漂移、重放、撤销、阶段 manifest 与越权隐藏操作。

## 5. Capture 原子可见性

- `VisitCapturePublisher` 后方使用 composite `CaptureStatePort` 与 `StagedMediaPort(stage/promote/verify/delete)`；稳定 object/Visit/media ID 和 hash/size 使每步可幂等重试。
- R2 stage/promote 在 D1 事务外完成（PoC 用受限 Workers get/put）；所有 live 对象核验成功后，唯一 D1 transactional `batch()` 才同时插入/发布 Visit、assessment、全部 media metadata、capture state 与最终 receipt。
- 任一前置失败只保存/回放 `recovery_required`，普通查询不可见；响应丢失用同 mutation 重放。24 小时未恢复进入 `abandoned`，reconciler 删除 staged/orphan；R2 绝不描述为 D1 事务的一部分。
- 故障矩阵覆盖每个 R2/D1 边界、部分 promote、事务回滚、响应丢失、重复/冲突、abandon 和重启，且不出现部分成功。

## 6. Nearby 与供应商策略

- `LocationResolver`、`RouteProvider`、`PlaceDiscoveryProvider`、`EntryAccessProvider` 是独立 ports，共用 fail-closed policy gate。D-P04 只提议 Google 固定 origin transport 的受限网络例外；用户已于 2026-09-17 确认且独立架构评审通过，但 policy、凭证、测试与部署门未完成前保持关闭。
- Nearby 只从 Atlas Catalog 取得已录入且已验证的 food 候选，绝不调用 `PlaceDiscoveryProvider`。当前小型 PoC 对候选逐项调用 Routes；进入真实批量数据前由 T-06A 增加持久坐标粗筛／Top-N 与 Route Matrix，再在步行层为空时计算少量电车候选。DeepSeek 不决定项目、距离、行程或排序。
- Google Geocoding/Routes 只做请求内位置/路线；不跨请求缓存或持久化 Google 内容，也不把其地址、坐标、geometry 放入 Leaflet。微信中相应内容块就近显示清晰的 “Google Maps” attribution，上线前提供公开 ToS/Privacy。
- D-P04 下 Google adapter 只接受结构化 query/body；endpoint 闭合集合为 `GET maps.googleapis.com:443/maps/api/geocode/json`、`POST routes.googleapis.com:443/distanceMatrix/v2:computeRouteMatrix`、`POST routes.googleapis.com:443/directions/v2:computeRoutes`，其他 tuple 与所有 redirect 均 fail closed。secret 只在最终 transport 注入，原始响应只经字段许可 mapper；该方案明确不提供逐 DNS／IP pin，且不适用于其他 provider 或返回 URL。
- Transit adapter 从 legs/steps 计算门到门时长、boarding/line identity 与 transfer count；步行接驳允许，只有全程 ≤20:00 且 transit line 不切换才是 direct，不能信任 `FEWER_TRANSFERS` 偏好。fixtures 覆盖 20:00/20:01、换乘、缺字段。
- `PlaceDiscoveryProvider` 只服务 Catalog intake。Foursquare 实验保留为未启用的可替换 adapter，不是 Nearby 或建档的既定依赖；最终 intake 供应商待 Google Places／开放数据／用户确认数据的持久化与地图许可比较后决定。任何 API agreement 都必须逐字段证明读取、瞬时展示、持久化权利；rating 未获许可即 unknown。
- EntryAccess 分离 walk-in/queue assertion；reservable/reservations 只属预约事实，没有明确现时来源即 unknown。provider 原文不持久化。
- 版本化矩阵逐字段规定 request-only/chat/durable/Leaflet 禁止项，并保存 credential scope、origin、redirect/DNS/SSRF、attribution、条款证据和 contract tests。

## 7. 隐私、成本与验收

- DeepSeek 只接收批准的最少文字和不可还原的附件元数据；图片 bytes、缩略图、EXIF、供应商密钥、D1/R2 凭证均不得进入模型。
- `UsageCostMeter` 汇总 Lightsail/Cloudflare 固定成本与 DeepSeek 与已启用地点/路线 provider 的变动成本，按真实账单/usage 校准月度 projection；总 run-rate 硬门为 60 美元并保留 buffer。
- 每项 provider 设 warn/hard quota；硬限后 fail closed 为 unknown/dependency warning，不自动升级付费层。read、write、七天 soak 前各保存预算报告。
- 固定日本样本校准覆盖、消歧、路线、provenance；真实 E2E 覆盖入口重启/断网、零模型 trace、微信 event ID 稳定性、manifest 权限、媒体恢复及地图读取同一结果。

## 8. ADR、复核与依据

- `docs/decisions.md` D-021 接受确定性项目命令路由；D-P03 提议 Cloudflare + Google Routes，并把地点发现保持为可替换、未选定的 Catalog intake adapter；D-P04 提议 Google 固定 origin 的受限 PoC egress 例外，用户已确认且独立架构评审通过，仍待其余接受条件闭合。runtime/channel、网络保证或供应商条款、价格、覆盖、质量变化时重审。
- 依据：OpenClaw 2026.7.1 安装包的 plugin command SDK/runtime 与腾讯微信 adapter 入站映射（版本锁定证据）；[hook issue](https://github.com/openclaw/openclaw/issues/108349)；[Google Transit](https://developers.google.com/maps/documentation/routes/transit-route)／[Geocoding policy](https://developers.google.com/maps/documentation/geocoding/policies)／[Routes policy](https://developers.google.com/maps/documentation/routes/policies)。
- 依据：[Foursquare API](https://docs.foursquare.com/fsq-developers-places/reference/places-api-overview)／[response fields](https://docs.foursquare.com/fsq-developers-places/reference/response-fields)／[pricing](https://docs.foursquare.com/developer/reference/upcoming-changes)；[Cloudflare Workers](https://developers.cloudflare.com/workers/platform/pricing/)／[D1](https://developers.cloudflare.com/d1/platform/pricing/)／[R2](https://developers.cloudflare.com/r2/pricing/)。
