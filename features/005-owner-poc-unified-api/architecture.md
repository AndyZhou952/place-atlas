# 架构 — Owner PoC 统一应用操作

- 日期：2026-09-21
- 对应规格：[`spec.md`](./spec.md)
- 状态：confirmed；第 3 轮独立评审通过，进入 implement
- 用户确认：2026-09-21

## 对齐产品架构

本片遵守 [`product/architecture.md`](../../product/architecture.md) 的模块化单体、Ports & Adapters 与唯一 Application Operations 原则，落在 Web/UI adapter、Conversation Coordination、Application Operations、Atlas Catalog、Personal Memory 与 Decision Support。feature 004 的 Google egress 例外不进入持有 Owner 写权限与私人存储的 Worker；新增独立只读 Route Sidecar 信任区，须按 D-P05 复审后才可启用。

## 本片模块与缝

| 模块 | 小接口 | 隐藏的实现 |
|---|---|---|
| `PublicReadManifest` | `authorize(operation, principal)`、`project(operation, result)` | 存储前授权、闭合版本 DTO、未知读取默认拒绝、禁止领域对象直序列化 |
| `OwnerCredential` | `verifyLogin(candidate)`、`issueSession(subject, version)`、`verifySession(cookie)`、`clearSession()` | raw Secrets、常量时间比较、至少 256-bit signing secret、version/secret 轮换失效 |
| `InvocationCoordinator` | `execute(operation, input, context)`、`mutate({operation,input,mutationId,invocation})` | schema normalization、唯一版本 canonicalizer、authoritative digest、claim/write/receipt |
| `AgentOperationGateway` | `handle(signedEnvelope)` | HMAC、owner/channel/scope、nonce、phase manifest |
| `NearbyRecommendation` | `execute({locationHint})` → structured result | owner Catalog shortlist、路线 evidence、个人事实、稳定排序 |
| `RouteEvidencePort` | `resolveLocation(query)`、`walkingMatrix(origin, destinations)` | 窄 service binding、attribution、request-only contract |
| `GoogleRouteSidecar` | typed request → typed evidence | Google key、固定 endpoint、禁 redirect；`workers_dev=false`、无 routes/owner bindings |
| `OwnerPocComposition` | bindings → application/adapters | owner D1/R2、Public Read、mutation ledger、clock 与 session wiring |

## 核心数据与不变量

- 规范地点与个人事实只在 owner D1：`atlas_items`、overrides/tombstones、`place_assessments`、`visits`、`visit_media`。
- seed manifest 固定为 `owner-poc-seed-v1`、5 条、源 `verified-items.ts` SHA-256 `45f15c384c3688489822c34a14ae69ae2490aeb07b7c239623d5d76cbe03af41`；migration contract 校验规范 payload/count/digest。
- Public Read v1 只含规格定义的闭合 `PublicCatalogItemV1`、`PublicAssessmentV1`、`PublicVisitV1`、`PublicVisitMediaV1` 与 display media stream；禁止 object key、原文件名、hash、内部存储 ID、审计字段。未知 operation/字段默认 Owner-only。
- `InvocationContext` 含 principal/channel/scopes/requestedAt；coordinator 输入只含 operation/input/mutationId/invocation。schema normalization 后由唯一版本 canonicalizer 对 `{operation,input}` 计算 authoritative digest；Web 不提交 digest，Agent transport digest 不成为事实。
- 所有非幂等 mutation 发布前进入原子 claim/write/receipt；assessment assignment 也接受稳定 client mutation ID。
- provider ledger 以 provider + SKU + UTC period 为键；Geocoding cap 8,000 requests/月，walking Matrix cap 8,000 billable elements/月，预留失败零 egress、调用失败不退款。Transit 未启用。

## 信任区与关键流程

```text
Anonymous read -> authorize (before storage) -> AtlasApplication/D1/R2 -> project closed DTO
Unsafe Web -> OwnerCredential -> InvocationContext -> InvocationCoordinator -> same operation
WeChat /jpmap -> HMAC gateway -> InvocationContext -> InvocationCoordinator -> same operation
Nearby -> owner Catalog shortlist -> SKU ledger reserve -> RouteEvidencePort
       -> private service binding -> GoogleRouteSidecar -> fixed Google endpoint
```

Sidecar 只持 Google key，不绑定 Owner 密码、owner D1/R2 或 Agent HMAC；配置 `workers_dev=false` 且无 routes。preflight 必须证明直接公网 URL 不可达、未绑定 Worker 无法调用。它只接收本次位置线索与 shortlist 坐标，返回带 attribution/source/checkedAt 的闭合 evidence；原始 JSON、解析地址/坐标与路线 payload 不持久化、不入日志/prompt/Leaflet。

## 部署、切换与回退

1. 新建 owner-poc D1/R2/Worker、Route Sidecar、Secrets 与 seed v1；旧 fixture 零修改。
2. Sidecar threat model、固定 endpoint、request-only、attribution、ToS/Privacy 与双 hard-cap 经独立评审后才启用。
3. Web 面先完成 public/Owner smoke 后独立灰度；失败只回退 Web URL。
4. 再 provision 新 Agent key/endpoint，完成 owner 与 negative probes 后独立切 OpenClaw；失败只回退 Agent endpoint/key。
5. 回退是只读功能降级；owner-poc 新写入不反向迁移到旧 fixture。

## UI 与横切约定

- 复用 warm editorial atlas，taste 3/1/3；Login 是 shell 内非 modal Owner 区域，现有地图与控件不变。
- `ATLAS_OWNER_PASSWORD`、至少 256-bit 的 `ATLAS_OWNER_SESSION_SECRET`、Agent HMAC 与 Google key 只存在各自 Secrets；session version/secret 轮换使旧 Cookie 失效，缺失失败关闭。
- Web/Agent 不直接写 D1/R2；destructive、maintenance、底层 `catalog.save_discovered` 默认不在 Agent manifest。

## ADR 链接

- 继承 [`D-021`](../../docs/decisions.md) 的确定性项目路由。
- [`D-022`](../../docs/decisions.md) 记录 Public Read Projection；[`D-P05`](../../docs/decisions.md) 记录独立 Google Route Sidecar。D-P04 只继续约束 Sidecar 内的固定 endpoint transport，不能扩展到 owner write Worker。
