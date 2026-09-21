# T-04 OpenClaw 本地部署包代码评审（第 2 轮）

- 日期: 2026-09-13
- 评审方式: subagent
- 固定点: `HEAD df2ec5958e974debca70b27b977662fd75cb7b87`，含当前未跟踪的 T-04 artifact
- 范围: `features/004-openclaw-atlas-poc/deployment/openclaw-poc`
- 结论: 通过

## Standards

未发现严重或一般问题。

- `package.json` 的 Node engine 与 OpenClaw `2026.7.1` npm 包声明一致；`src/host-preflight.mjs` 精确拒绝越界 Node 与非 `2026.7.1` OpenClaw，`scripts/host-preflight.mjs` 实际执行 `node:sqlite` 查询，任一检查失败均返回非零状态。
- 第一次复核中发现的已安装包断链已修复：预检入口改为引用随包交付的 `dist/host-preflight.mjs`。从最终 archive 解包后执行 `npm run preflight:host`，能产生完整三项报告，并在本机 Node `22.13.0`／无 OpenClaw 时以状态 1 安全 STOP；不再依赖未交付的 `src/`。
- manifest 现在以 `toolMetadata.jpmap_router.optional: true` 与 runtime `registerTool(..., { optional: true })` 对齐，符合 OpenClaw 2026.7.1 的静态发现／冷加载约定。
- `npm pack` 只交付 8 个预期文件；未发现 secret、真实账号 ID、实例 IP、私钥材料或额外依赖。`src` 与 `dist` 三个 runtime 文件一致。

## Spec

未发现严重或一般问题。第 1 轮四项发现均已关闭：

1. `jpmap_router` 同时在 manifest 与 runtime 标记为 optional；skill 是 `user-invocable`、`disable-model-invocation`、raw `command-dispatch: tool`，唯一命令仍为 `/jpmap nearby <manual address or area>`。
2. tool factory 只使用 OpenClaw 2026.7.1 实际声明为 trusted 的 `requesterSenderId`、`senderIsOwner`、`messageChannel` 与 `deliveryContext`。缺失上下文、非 owner、第二 sender、非微信、不同 DM target 或 thread 均返回 `null`，不会建立 client／发起 Worker 请求；环境 owner 值只参与比较，伪造静态 `trustedActor` 不能替代本次调用者。channel、conversation type 与 read scope 也不能通过 command 参数自我提升。
3. response 在 JSON parse 前同时执行 16 KiB `Content-Length` 早拒绝与实际 stream 累计上限；缺失或欺骗长度仍受 stream cap 约束。HTTPS、固定 path、4 秒 timeout、非 2xx、畸形 UTF-8/JSON/receipt 均失败关闭。
4. URL-shaped location（含带 scheme、无 scheme path、以及裸 `maps.app.goo.gl` host）固定提示复制地址且零 egress；其他非法命令同样零 egress。

canonical path/body digest/HMAC header 与 `apps/web/product/application/conversation/agent-request-signing.ts` 仍一致；合法请求只发送 `projectId=jpmap`、`tool=jpmap_nearby`，没有 write、shell、GitHub、Cloudflare 管理、D1/R2、maintenance、reset 或 destructive capability。

## 已知外部门禁（不属于本地 artifact 缺陷）

OpenClaw 2026.7.1 的 public `OpenClawPluginToolContext` 提供上述可信 requester/channel/delivery 字段，但没有可信的 “invoked by this skill direct-dispatch” 来源标记；direct-dispatch 也经过正常 tool policy seam。因此，只靠本包无法同时证明“slash 可调用”与“同一 owner 的普通模型绝不可调用”。

`README.md:64-70,77-92` 对此限制表述准确：不得把 `jpmap_router` 加进通用 `tools.allow`；实际宿主若不能让 slash direct-dispatch 使用 optional tool 且仍将其排除于普通模型 catalog，必须停止部署并保持 Read-only gate 关闭。AWS＋微信上的 owner DM、第二 sender、group、ordinary model 与 URL 零 egress 证据仍是上线门禁，而不是本轮代码通过后自动豁免。

## 验证证据

- 通过：聚焦 contract tests 10/10（包括 installed-layout preflight、manifest/runtime optional 对齐与裸地图 host 零 egress 回归）。
- 通过：`npm run lint`、`npm run build`、`src`/`dist` 一致性比对。
- 通过：`npm pack --dry-run --json`；最终 archive 为 7,057 B / 18,998 B unpacked，8 个预期文件。
- 通过：从最终 archive 解包后运行 `npm run preflight:host`；结构化报告正常，当前不兼容宿主安全退出 1。
- 通过：敏感值／禁止能力扫描与 `git diff --check`。
- 对照：OpenClaw `2026.7.1` npm tarball 内 `docs/tools/skills.md`、`docs/plugins/building-plugins.md`、`docs/plugins/tool-plugins.md`、`docs/plugins/manage-plugins.md`、`dist` SDK declarations 与 tool-dispatch implementation。
