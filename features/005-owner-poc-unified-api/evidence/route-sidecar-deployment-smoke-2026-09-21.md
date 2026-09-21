# Route Sidecar deployment smoke evidence — 2026-09-21

本记录只保存可公开的脱敏结论。它不包含 URL、Cloudflare 资源／版本／账号标识、凭证或 Secret 值，也不包含任何 Google provider 响应。

## Secret 与隔离边界

- 远端 Secret evidence 恰好包含一个 `secret_text` 名称：`GOOGLE_MAPS_API_KEY`；未读取或记录其值。
- 部署前后 private-route preflight 均通过：配置保持 `workers_dev=false`、preview URLs 关闭、routes 为空，精确公网入口不可达。
- Sidecar 没有 Owner D1、R2、Owner session、Agent HMAC 或其他 service binding；未绑定的 Owner Worker 仍失败关闭。

## Strict deploy

- strict deploy 成功上传经评审的 Sidecar bundle；上传大小 13.17 KiB、gzip 3.43 KiB。
- Wrangler 报告没有 deployment targets；部署后再次核验 Secret name/type 与 private-route preflight，均通过。
- 本次 Sidecar 独立部署阶段没有部署 Owner service binding，没有调用真实 Google provider，也没有产生 Geocoding 或 Route Matrix 用量。

## 后续门禁状态

- 项目 Owner 后续已确认 Google Cloud key restriction、Geocoding/Route Matrix 日配额、billing guard；应用侧双 8,000 UTC 月度 hard cap 继续作为第二道门。
- T-07 后续已完成 Owner 精确 service binding、Web/Agent 等价、request-only 负面契约与公开 Terms/Privacy，并通过独立最终评审。
- 最新匿名 smoke 后聚合 SKU ledger 仍为空，因此尚未调用真实 Google provider。
- D-P05 继续保持 Proposed，T-06 只剩一次已登录 Owner 的真实 provider smoke。
