# 规格评审（第 3 轮）

- 日期: 2026-09-21
- 评审方式: subagent
- 结论: 通过

## 发现项

- 无。

## 复核结论

- 用户已明确确认总体评论、Visit 日期/展示笔记和照片原图允许匿名查看；规格将该例外限制为非敏感 PoC，并保留真实敏感内容前收窄投影和重审门。
- Public Read Projection v1 已闭合到具体 operation 与 `PublicCatalogItemV1`、`PublicAssessmentV1`、`PublicVisitV1`、`PublicVisitMediaV1` 字段；媒体使用 opaque display ID，object key、原文件名、hash、内部存储 ID、审计/receipt/维护字段均有明确负面约束。
- 匿名读取顺序已固定为 Application/R2 前 `authorize`、执行后 `project`，未知读取事前拒绝，领域对象不得直接序列化，并有 sentinel-field 泄漏测试。
- `InvocationCoordinator` 在 schema normalization 后用唯一版本 canonicalizer 计算 authoritative digest；Web 不提交 digest，Agent transport digest 只校验/比对，receipt/claim 不信任渠道 digest。
- Session signing secret 已要求密码学安全随机源和至少 256-bit；version 或 secret 轮换使旧 Cookie 失效。
- Sidecar 已要求 `workers_dev=false`、无 routes，并以公网不可达、未绑定 Worker 不可调用的 preflight 作为上线门。
- 第 1、2 轮其余问题——raw Secret 契约、分 SKU 8,000 caps、request-only/attribution、seed manifest 及 Web/OpenClaw 双入口切换——均保持闭合。

D-P05 仍是 Proposed；本结论批准规格进入后续阶段，不替代 T-06 要求的 Sidecar 独立威胁模型、实现证据和安全评审，真实 Google 调用在该门通过前继续 fail closed。
