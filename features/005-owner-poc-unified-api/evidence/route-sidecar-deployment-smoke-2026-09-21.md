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

## 首次 Owner smoke 与 v3 鉴权修复

- Owner 输入一个完整东京地址后收到 false `not_found`；只检查聚合 ledger，确认 Geocoding 有 3 次预留而 walking 为 0。未读取或保存 provider 原始响应。
- TDD 证明两个叠加问题：经典 Geocoding v3 未使用官方要求的 `key` query 鉴权；HTTP 200 的 `REQUEST_DENIED` 会被旧 mapper 错误折叠为空结果。
- 修复后仅 `OK + 非空结果` 与 `ZERO_RESULTS + 空结果` 合法；其他状态或矛盾 payload 均关闭为 `dependency_failure`，provider 详情不外泄。
- 独立安全复审确认 key 仅在最终固定 Geocoding fetch 注入，未进入日志、返回、持久化或 bundle；Routes header 鉴权、固定 endpoint、manual redirect 与 no-store 未回归。
- Sidecar 23/23、dry-run bundle/preflight、typecheck、lint 与 format 通过。修复 bundle 已 strict deploy；部署前后 secret-name-only 和公网不可达 preflight 均通过。
- 当前仍未宣称真实路线链路成功；须由 Owner 再执行一次相同地址查询，并只核对闭合 UI 输出与聚合 SKU ledger。
