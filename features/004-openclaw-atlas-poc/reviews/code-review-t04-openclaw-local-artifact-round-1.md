# T-04 OpenClaw 本地部署包代码评审（第 1 轮）

- 日期: 2026-09-13
- 评审方式: subagent
- 固定点: `HEAD df2ec5958e974debca70b27b977662fd75cb7b87`
- 范围: `features/004-openclaw-atlas-poc/deployment/openclaw-poc`
- 结论: 需修改

## Standards

- [一般] `features/004-openclaw-atlas-poc/deployment/openclaw-poc/package.json:20-22`、`README.md:45-65`: package 将 Node engine 声明为 `>=22.22.3`，但 OpenClaw `2026.7.1` 的实际 npm 元数据是 `>=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0`；当前声明会误允许不支持的 Node 23 和过旧 Node 24/25，runbook 也未在安装前保存实际 `node -v` 与 `openclaw --version` 证据。→ 将 engine 锁定到 2026.7.1 的精确支持矩阵，并在安装前检查/记录宿主 Node、SQLite capability 与 OpenClaw 版本；不匹配时停止。

未发现其他严重或一般 Standards 问题。构建后 `src`/`dist` 完全一致，`npm pack --dry-run` 只包含两个 runtime 文件、manifest、skill、package metadata 和 runbook，没有带入测试或开发文件。

## Spec

- [严重] `features/004-openclaw-atlas-poc/deployment/openclaw-poc/src/index.mjs:20-35`、`src/jpmap-client.mjs:36-47,118-126`、`README.md:41-65`: `jpmap_router` 以默认 required tool 注册，因而在插件启用／允许后仍属于普通模型可用 tool surface；`disable-model-invocation` 只会隐藏 skill 指令，不会使底层 tool 变成只能由 slash dispatcher 调用。同时 client 忽略本次工具调用的可信 channel/requester context，无论实际调用者是谁，都会把环境变量中的 owner actor/conversation 签名后发给 Worker。因此普通模型调用或被 OpenClaw 放行的第二账号可冒用 owner 上下文，服务端无法辨别真实来源，违反“项目选择先于模型”和 owner/channel/conversation 同时验证。现有测试直接调用 tool `execute` 即能成功，反而证明缺少这一边界。→ 使用 OpenClaw 2026.7.1 实际支持的可信 tool/channel context 验证 requester、channel 和 DM target，请求中携带经核验的实际身份，不得将静态 owner 值替换成任意调用者的身份；在实际 AWS+微信版本上证明普通模型无法调用该 tool、第二账号零 egress，否则 Read-only gate 保持关闭。
- [一般] `features/004-openclaw-atlas-poc/deployment/openclaw-poc/src/jpmap-client.mjs:61-75,166-186`、`test/jpmap-plugin.contract.test.mjs:165-212`: 请求体由 1,000 字符位置与有界身份字段间接限制，但响应在检查 4,096 字符 `replyText` 之前直接执行 `response.json()`，没有限制 HTTP response bytes；过大或恶意 JSON 仍会先被全量缓冲，无法证明 body-size fail closed。→ 在解析前以严格字节上限消费 response stream（`Content-Length` 只能作为早期拒绝，不能作为唯一保证），超限／缺少／欺骗长度均返固定 unavailable，并增加 stream 超限契约测试。
- [一般] `features/004-openclaw-atlas-poc/deployment/openclaw-poc/src/jpmap-client.mjs:95-116`、`test/jpmap-plugin.contract.test.mjs:69-93`: 闭合命令 parser 会接受 `nearby https://...` 并发起 egress，但已确认规格只接受手动地址／街区文字，收到地图分享链接时应要求用户复制地址正文。→ 对 URL-like location hint 固定返回用法／复制地址提示且保持零 egress，增加 `http://`、`https://` 和常见地图短链提示测试。

已通过的 Spec 项：OpenClaw skill frontmatter 是 user-invocable、no-model、raw direct dispatch；manifest 只声明 `jpmap_router`；合法命令只产生 `jpmap_nearby` 读请求，channel/type/scope 不受命令参数控制；canonical bytes、body digest、HMAC header 和服务端实现一致；非 HTTPS、带凭证／query／fragment 的 endpoint、缺配置、timeout、非 2xx、回执 mutation 不匹配及畸形回复都固定失败关闭；无效命令零 egress；实际包未包含 shell、GitHub、Cloudflare/D1/R2、write、maintenance、reset 或 destructive 实现，也未包含 secret、真实账号 ID 或 IP。

## 验证证据

- 通过：本地 contract tests 5/5。
- 通过：`npm run lint`、`npm run build`、`src`/`dist` 一致性比对。
- 通过：`npm pack --dry-run --json`，仅 6 个预期文件，4.8 KB archive / 12.5 KB unpacked。
- 通过：包内敏感值与禁止能力扫描、`git diff --check`。
- 官方对照: https://docs.openclaw.ai/tools/skills；https://docs.openclaw.ai/plugins/building-plugins；https://docs.openclaw.ai/cli/plugins/install；https://docs.openclaw.ai/install/node-compatibility
