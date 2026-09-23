# T-15 代码与安全评审（最终轮）

- 日期: 2026-09-23
- 评审方式: subagent
- 固定点: `39528082c14274dc6f561318ce9d611b092a2ccb`
- 结论: 通过

## 评审范围

- 当前工作树相对固定点的全部 tracked T-15 diff，以及 `apps/web/adapters/research-relay/` 的 10 个新文件和 append-only migration `0009_catalog_intake_research_allowances.sql`。
- 上游依据为 `CONTEXT.md`、本特性的 `spec.md`、`architecture.md`、`tickets.md` T-15，以及 `docs/decisions.md` D-P06。
- 三个既有 `.orig` 文件和四份已独立评审的 T-18 draft 均不属于本轮实现证据，未修改；本轮也未修改任何实现、任务票、部署配置或远端状态。

## Standards

### 发现项

无严重、一般或建议项。

### 代码与安全证据

- D1 在 Relay RPC 前以单条条件写原子消费 `initial`／`confirm` phase；条件绑定 session、scope、version、state、exact TTL 和权威 query/URL digest。phase 失败不退款，响应丢失后重试只能得到 `already_spent`，不会产生第二次 egress。
- allowance 与 result 分别使用 domain/audience/version/key version、完整 canonical payload、期限和 HMAC；result v2 是精确闭合的 `observed scalar proposal | unavailable` union。错误、额外字段、篡改、过期、错误 request/digest 和超预算 usage 均拒绝。
- Relay 在 egress 前使用持久 SQLite request claim；相同 request 跨进程重启仍为 replay，不同 digest 为 conflict。该库只保存 request ID、allowance digest 和期限，不保存 query、URL、页面或产品事实。
- OpenClaw seam 固定为 `openclaw.web_search` v1、最多 3 个 `url_candidates_only`；confirm 禁止 search，只接受 preview 绑定且排序去重的 canonical URLs。search、fetch、extractor 的失败与 provider stop 均签为通用 `unavailable`，晚期失败会丢弃 earlier partial evidence；只有显式 benign no-evidence 才返回 observed unknown。
- hardened transport 只接受 HTTPS:443、无 credentials/fragment/IP literal/metadata hostname；每跳同时解析 A+AAAA，任一非公网地址即整体拒绝，连接固定到已验证 IP并保持原 hostname SNI/Host，实际 connected IP 必须匹配；redirect 每跳重验且最多 3 次，connector retry/follow redirect 均关闭。
- response headers、content type/charset/encoding/content length、streamed bytes、阶段 deadline 和 cooperative abort 均有上限；raw HTML 仅在 Relay 内作为 extractor 的瞬时输入，签名结果、D1、replay store 与 Core DTO 均不携带 raw、snippet、review text、错误细节或模型记忆。
- Worker 只在 D1 成功消费后调用一次 Relay，传入 absolute deadline、`AbortSignal`、`maxAttempts: 1` 和 `redirect: error`；签名结果由 Worker 时间赋予 `agent_observed/observedAt/freshness`，Relay 不能自报 provenance/time。
- Core 的 initial/confirm 流程保持 closed outcome；provider failure 将既有 Agent evidence 标 stale 且保留原 observation time，并生成 canonical `stale_evidence/provider_unavailable` warning；benign observed unknown 不冒充 provider failure，Owner assertion 不被 Agent unknown 降级。
- 前轮发现的 exact-TTL CAS、expired/conflict closed outcome、same-facts applied marker、revision-race marker rewrite、provider failure/no-evidence 区分以及 adapters lint/format 覆盖均已复验关闭。
- package scripts 已将 `adapters` 纳入 lint、format 与 format-check；control-character 检查、AsyncIterator abort fixture、canonical Nearby type rename与 Nominatim 格式化改动均未改变业务行为。

## Spec

### 发现项

无严重、一般或建议项。

### T-15 接受范围

- 本轮实现满足 T-15 的本地可验证切片：不可借用的 `1 search + 3 pages + 35s` 与 `0 search + 2 pages + 25s` 预算、会话总计 `1 + 5 + 60s`、每 request 15s/3 redirects、权威 digest、单次消费、签名闭合 scalar、跨重启 replay defense、response-loss 单次 egress、SSRF/DNS rebinding/IP pin/SNI/redirect 防线、零 raw 持久化，以及 confirm-time evidence refresh/warning/preview/version 行为。
- `CatalogIntakeModule` 的 production default 仍未装配 `WebResearchPort`，会稳定 fail closed/manual-unknown；没有把 T-17 的 Agent Add manifest、确定性命令 adapter，也没有把 T-18 的生产部署、Secret、Tunnel、smoke 或回退提前纳入本票。

### D-P06 与后续票边界

- **D-P06 仍是 Proposed。** 当前仓库没有真实 Node/OpenClaw/Tunnel production RPC/HTTP adapter、Tunnel 身份配置、host-side Secret 装配或公网旁路实测证据；因此本评审不接受 D-P06、不授权启用 Relay，也不声称真实 Tabelog/预约研究已经上线。
- 该状态**不阻塞以安全关闭状态完成 T-15 代码票**：T-15 票和架构都明确要求任何无法证明的 tool/transport/Tunnel 保证必须令 Relay disabled 并回退 manual/unknown。当前实现确实保持这一默认；通过结论只覆盖已经实现并独立验证的本地 contract/security slice。
- **T-17** 可在该基础上完成 Web 与确定性 `/jpmap add` 双 adapter、统一 operations、权限/nonce/scope/receipt/read-after-write E2E；未接受 D-P06 时，研究必须继续是 disabled/manual-unknown，T-17 不得以 fixture 或本地 mock 声称真实 Relay 已可用，也不得开放 Record/destructive tools。
- **T-18** 才能为具体 artifact/configuration 装配并验证真实 Node/OpenClaw/Tunnel adapter、双端 Secret/binding、绝对 deadline/AbortSignal 与 no-auto-retry、Tunnel identity、无公网或通用 browser-fetch 旁路、host SQLite 权限/重启恢复、raw/log 零留存和真实负向 probes。只有这些 production preflight 与独立威胁复审通过后，D-P06 才可从 Proposed 转为 Accepted 并启用 Relay；否则 T-18 只能以 `relay_disabled_manual_unknown` 发布基础 Add。

## 独立验证

- T-15 focused contracts: `92/92` 通过。
- 完整测试: `601/601` 通过，0 fail/skip/cancel。
- `npm run typecheck`: 通过。
- `npm run lint`: 通过，且命令明确覆盖 `adapters`。
- `npm run format:check`: 通过，共检查 369 个文件；另直接检查 `adapters` 的 66 个文件通过。
- `npm run migration:check`: 通过，candidate site version 17 包含 append-only `0009`。
- `git diff --check 39528082c14274dc6f561318ce9d611b092a2ccb --`: 通过。
- `npm run build:owner-poc`: production build 通过；373 client、345 server、364 RSC、2087 client-environment、343 SSR modules 完成转换。仅有既有图片运行时解析提示和工具链 deprecation/experimental warning，无构建失败。

## 最终判断

Standards 与 Spec 两轴均为 `0 严重 / 0 一般 / 0 建议`，T-15 代码与安全门通过。该结论允许主流程关闭 T-15 并进入 T-17；它不改变 D-P06 的 Proposed 状态，也不授权 production Relay、Tunnel、OpenClaw research 或任何部署动作。
