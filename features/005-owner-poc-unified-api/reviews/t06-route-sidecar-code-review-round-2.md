# T-06 Google Route Sidecar 代码／安全评审（第 2 轮）

- 日期: 2026-09-21
- 评审方式: subagent
- 固定点: `b201a3c5887bdda8d2a71be732f511b035a8998a`
- 复审范围: 仅复核第 1 轮三个发现项；实现范围仍限于 `apps/web/route-sidecar/**`、`apps/web/wrangler.route-sidecar.jsonc`、`apps/web/scripts/route-sidecar-*`、`apps/web/package.json` Sidecar/质量门 scripts 与 Route Sidecar runbook
- 明确排除: T-05 Nearby operation/browser/composition、全部 `.orig`、真实 provider 调用、远端部署、远端 service binding 与远端不可达性证据
- 结论: 通过
- 用户确认: 2026-09-21（用户指示继续；仅确认本地实现，远端门禁不变）

## Standards

### 发现项

- 无。

### 复核结论

- `apps/web/package.json:21-23` 已将 `route-sidecar` 纳入 `lint`、`format` 与 `format:check`；不再存在 Sidecar 主实现绕过仓库质量门的问题。
- 评审者独立执行 `npm run lint` 与 `npm run format:check`，均通过；format 实际覆盖 264 个文件。
- `npm run typecheck` 与 scoped `git diff --check` 均通过。
- 第 1 轮失败的 7 个 Sidecar 文件现已通过主 format gate。

## Spec

### 发现项

- 无。

### 复核结论

- `inspectRouteSidecarDeployment` 现在要求 secret evidence 恰好只有一个闭合 `{name:'GOOGLE_MAPS_API_KEY',type:'secret_text'}` 对象；空列表、重复项、额外字段、错误 type、缺 name 与非字符串 name 全部失败关闭。
- 评审者重跑第 1 轮的精确复现：“合法 Google secret + `{name:123,type:'secret_text'}`”，结果为 `ready:false` 且 blocker 为 `secret_evidence_malformed`。
- contract 已证明缺 Google secret 时 Geocoding 与 Matrix 都返回 `not_configured` 且 fetch 次数为零。
- contract 已逐一覆盖 300、301、302、303、307、308：两个 endpoint 都使用 `redirect:'manual'`，Geocoding 固定为 GET、walking Matrix 固定为 POST，每个响应映射为 `dependency_failure` 且测试 transport 不执行跳转。
- `npm run test:route-sidecar`: 17/17 通过。
- `npm run build:route-sidecar`: Wrangler `--dry-run` 通过，产物 13.17 KiB（gzip 3.43 KiB），显示 `No bindings found` 与 `--dry-run: exiting now`；bundle preflight 通过。该命令没有上传、部署或调用真实 Google provider。
- 第 1 轮已确认的隔离、闭合 evidence、双 8,000 hard cap、reserve-before-call、失败不退款、缺 service binding 零 reservation 与 public-probe inconclusive fail-closed 结论未被本轮修复破坏。

远端 secret provision、直接公网不可达、Owner service binding、Google Cloud quota 与真实 Google smoke 仍是后续部署／T-07 证据，本轮通过不替代这些门禁。
