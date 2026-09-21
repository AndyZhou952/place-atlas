# T-04 OpenClaw native `/jpmap` command 代码评审（第 1 轮）

- 日期: 2026-09-13
- 评审方式: subagent
- 固定点: `HEAD df2ec5958e974debca70b27b977662fd75cb7b87`；Feature 004 当前为未跟踪工件，按相对该固定点的新增实现评审
- 范围: `features/004-openclaw-atlas-poc/deployment/openclaw-poc`、`apps/web/adapters/agent/isolated-readonly-agent-service.contract.test.mjs`
- 结论: 通过
- auto-approved: 2026-09-13

## Standards

未发现严重或一般问题。

- runtime 只调用一次 `api.registerCommand`，没有 `registerTool`、skill dispatch、hook 或通用执行 fallback。命令 handler 保持为薄 adapter，闭合语法、可信上下文解析、签名、边界响应读取集中在 `jpmap-client.mjs`，未把 OpenClaw SDK 引入产品核心。
- 身份检查失败关闭：只有 `isAuthorizedSender === true`、sender 精确等于配置 owner、`channel` 与 `channelId` 都精确等于 `openclaw-weixin`、`from`/`to` 都精确等于 owner DM、且无 message/thread parent 的上下文才能创建签名 actor；缺字段、第二账号、其他 channel、不同会话和 thread 均为零 Worker egress。调用方提供静态 `trustedActor` 不被接受。
- 独立只读核对 Lightsail 上 OpenClaw `2026.7.1`：`PluginCommandContext` 确实提供上述字段，`handlePluginCommand` 在 agent 前匹配并将其传给 `executePluginCommand`；腾讯 Weixin adapter `2.4.8` 将 `Provider`/`OriginatingChannel` 设为 `openclaw-weixin`，DM 的 `From`/`To` 均设为 `from_user_id`。OpenClaw 的 `buildCommandContext` 因而生成与实现精确检查相容的 `channel`、`channelId`、sender、from/to。
- response 在 JSON 解析前受 16 KiB 实际 stream 上限保护；endpoint 只接受无 credentials/query/fragment 的 HTTPS 固定 path，timeout、HTTP 错误、畸形 receipt、超长/控制字符回复均映射为固定脱敏错误。
- `src` 与 `dist` 三个 runtime 文件逐字一致；dry-run package 只有 7 个预期文件，没有 tests、skills、`.orig`、真实账号、实例地址、私钥或 API key。未发现本增量引入的神秘命名、重复逻辑、越界抽象或其他代码异味。

## Spec

未发现严重或一般问题。

- 规范 `/jpmap` 已改为 OpenClaw 原生 command：`channels=["openclaw-weixin"]`、`acceptsArgs=true`、`requireAuth=true`，运行时实现确认 plugin command 在 built-in/agent 之前处理；普通模型无需且无法选择 Atlas tool。
- manifest 只有 `commandAliases: [{ name: "jpmap", kind: "runtime-slash" }]`；不存在 `contracts.tools`、`toolMetadata` 或 `skills`，package 也不交付 skill。由此关闭旧版 `jpmap_router` 必须加入普通模型 allowlist 才能 direct-dispatch 的冲突。
- 只读 client 仍只允许 `nearby <Location Hint>`，固定发送 `projectId=jpmap`、`tool=jpmap_nearby` 与 read-only HMAC envelope；隐藏 write/destructive tool 在 Worker 侧继续拒绝。`/jpmap add`、bare alias 与 capture 没有被本 T-04 提前开放。
- `银座`、`銀座`、`ginza` 三种自由文字均原样（除命令边界空白）进入 Worker 的 `locationHint`。测试与文档只承诺 Unicode 透传；没有把当前 fixture 的同一结果冒充真实 geocoding 等价，后者仍由 Google resolver 校准门控制。
- client→Worker contract 真实经过 HMAC 校验、owner/channel binding、隔离 D1 fixture 与审计；非 fixture 环境、隐藏写工具、重复/冲突 receipt 均按规格失败关闭。

## 发现项

无。

## 验证证据

- 通过：OpenClaw plugin contract/hardening tests 11/11。
- 通过：`npm run lint`、`npm run build`、三个 `src`/`dist` 一致性比对。
- 通过：`npm pack --dry-run`；6.8 kB archive、18.4 kB unpacked、7 个预期文件，无 tool/skill 工件。
- 通过：isolated Worker client→service cross-boundary contract tests 5/5。
- 通过：禁止能力/敏感值扫描与 scoped whitespace check。
- 对照：Lightsail 实装 OpenClaw `2026.7.1` 的 `PluginCommandContext`、`handlePluginCommand`/`executePluginCommand`，以及腾讯 Weixin adapter `2.4.8` 的 inbound context 源码。

## 剩余外部门禁

本代码门不等于 T-04/T-09 完成。仍须把 `0.2.0` 安装到 Lightsail，并由 runtime inspection 证明 `commands` 含 `jpmap`、plugin `toolNames` 为空；随后用 owner 微信 DM 保存成功 trace、第二账号／thread 拒绝证据和模型调用计数为零。真实 `银座`／`銀座`／`ginza` 地理等价仍须经启用后的 Google `LocationResolver` 校准，当前 fixture 不能提供该证明。
