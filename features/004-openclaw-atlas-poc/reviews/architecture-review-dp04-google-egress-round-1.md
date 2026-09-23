# 004 D-P04 Google 固定 origin egress 架构增量评审（第 1 轮）

- 日期: 2026-09-15
- 评审方式: subagent
- 审查对象: D-P04 proposed decision 及其对 `architecture.md` 的增量
- 结论: 需修改

## 审查范围与对齐

- 独立冷读 `hf-review` 与 design checklist、`CONTEXT.md`、`product/architecture.md`、feature 004 的 `spec.md`、`architecture.md`、`progress.md`，以及 `docs/decisions.md` 的 D-P03/D-P04 和前轮架构评审。
- D-P04 如实承认这是对现有逐 DNS 解析／已验证 IP 绑定契约的受限偏离，而非等价实现；Cloudflare Workers 无法把标准 HTTPS `fetch` 实际连接固定到预验证地址的 TOCTOU 缝没有被掩盖。
- 增量继续限定为隔离、只读 Nearby PoC：Google adapter 不接收 URL，输入仅能影响 schema-validated query/body；manual redirect 的所有 3xx 返回 `dependency_failure`；非 Google provider、返回 URL 与未来 URL fetch 仍走原 `ProviderPolicyGateway` 的 origin/DNS/IP/redirect 门，无法满足时 fail closed。
- secret 仅在最终 transport 注入，缺失 fail closed；字段许可、warn/hard quota、request-only 保留、原始 JSON mapper 隔离与无日志／D1／R2／prompt／receipt 泄露均有明确归属。B/C 保留为更强保证的回退，并有明确接受与重审门。

## 发现项

- [一般] `docs/decisions.md:203,211,213`、`features/004-openclaw-atlas-poc/architecture.md:55`: 文本称 origin、port、path 与 method “由代码选择／固定”，但没有列出闭合的 `(official origin, port, path, method)` allowlist。因而 contract tests 无法从已评审架构判定某一代码路径是否仍是预批准的 Google Geocoding 或 Route Matrix endpoint，而不是同一 host 上新增的 Google API path/method；这会把 D-P04 的核心网络边界留给实现自由裁量。→ 在 D-P04/架构中列出仅允许的精确 endpoint tuples（及各自接受的结构化 query/body schema），规定任何未列 tuple 一律 `dependency_failure`，并把正向与所有未列 path/method 的负向 contract tests 纳入接受条件；新增／改变 tuple 继续触发既有重审条件。

## 结论说明

除上述可测试的 endpoint allowlist 缺口外，增量保持产品架构的 ports/adapters 边界，没有把 Cloudflare/Google 引入 Product Core，也没有扩张为通用代理、TLS/DNS pinning proxy 或未来 provider 抽象。D-P04 仍是 **Proposed（待用户确认）**：本评审不构成用户确认、不会将其标为 Accepted，也不授权启用 policy、部署或使用真实凭证。修复 finding 后须再次由独立 reviewer 复审。
