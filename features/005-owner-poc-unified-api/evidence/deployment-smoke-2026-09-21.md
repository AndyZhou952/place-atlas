# Owner PoC deployment smoke evidence — 2026-09-21

本记录只保存可公开的脱敏结论。它不包含 URL、Cloudflare 资源 ID、账号或凭证、Owner/Agent 身份、审计内容、评论文本或其他私人数据。

## Provision 与发布

- 新的 owner-poc D1、R2 与 Worker 已隔离 provision；旧 Worker、D1 与 R2 未修改。
- migrations 0001–0005 已应用；0005 的 D1 兼容 hotfix 已通过独立评审。
- Seed evidence 与 deployment preflight 通过。
- Fresh secret-only placeholder 首次需要一次 non-strict bootstrap，随后立即 strict deploy；最终 live 版本由 strict deploy 发布在公开的 owner-poc workers.dev 入口。

## Public 与 Owner smoke

- Public Catalog 返回 HTTP 200 和 5 条规范记录；Public Journal 返回 HTTP 200。
- 匿名同源写请求返回 HTTP 401，写入计数保持不变。
- 错误 Owner 登录返回 HTTP 401，且不设置 session cookie。
- 用户在 live 环境确认 Owner 登录成功；总体评论、喜欢与去过状态均可写入并读回。
- 写入体感延迟作为独立性能问题记录在 GitHub #10，不在此证据中包含私人输入或时序细节。

## Agent smoke

- 来自 AWS 的有效 signed Agent Nearby 请求到达预期的 route-service-pending 边界，并产生预期 nonce、receipt 与 audit 记录。
- 非 Owner sender 被拒绝，相关计数保持不变。

## 尚未关闭的门

- T-05 的结构化 Nearby 已完成；Route Sidecar 已完成隔离 strict deploy，但 T-06 的外部 quota／真实 provider 证据和 T-07–T-08 尚未完成。
- 永久 OpenClaw endpoint 切换与回退演练尚未执行，因此 T-11 保持未完成。
