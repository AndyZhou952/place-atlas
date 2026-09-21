# T-06 Wrangler 兼容修正评审（第 3 轮）

- 日期: 2026-09-21
- 评审方式: subagent
- 评审范围: 仅 `deployment/cloudflare-route-sidecar/README.md` 与 `route-sidecar-deployment-preflight.test.mjs` 的 Wrangler secret-list JSON 输出兼容修正
- 明确排除: 其他 T-05/T-06 实现、`.orig`、Secret 读取／写入、真实部署与 provider 调用
- 结论: 通过
- 用户确认: 2026-09-21（用户指示继续；远端门禁不变）

## Standards

### 发现项

- 无。

### 证据

- 本机 `wrangler secret list --help` 声明 JSON 输出参数为 `--format json`（`--format` choices 为 `json|pretty`），与 runbook 修正一致。
- focused preflight tests 5/5 通过。
- 从仓库根目录对两个范围文件执行 `oxfmt --check`，2/2 通过；scoped `git diff --check` 返回 0。
- 本轮没有执行 secret list、deploy 或任何真实网络/provider 操作。

## Spec

### 发现项

- 无。

### 复核结论

- runbook 的部署前与部署后两处 secret-name evidence 命令都改为 `npx wrangler secret list --config wrangler.route-sidecar.jsonc --format json`，仍只把 name/type JSON 写入 ignored `.wrangler` evidence 文件，没有扩大权限或泄漏 secret value。
- 新 contract 精确断言 runbook 中恰有两条 `secret list` 命令、两条都含 `--format json` 且均不含旧 `--json`，可防止 CLI 兼容错误回归。
- 此修正只恢复既有 T-06 preflight 证据采集步骤，不改变 Sidecar 信任区、运行时 binding、Google capability、hard cap 或发布门语义。
